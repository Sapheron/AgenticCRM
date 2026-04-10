/**
 * BroadcastService — single write path for everything Broadcast-related.
 *
 * Mirrors the Leads/Deals/Tasks/Products upgrades. Every mutation:
 *   1) Logs an entry to `BroadcastActivity` (the timeline)
 *   2) Auto-attributes the action via a `BroadcastActor` (user/ai/system/worker)
 *   3) Enforces a state machine (DRAFT → SCHEDULED → SENDING → COMPLETED, with
 *      PAUSED, CANCELLED, FAILED branches)
 *
 * The worker pipeline (`apps/worker/src/jobs/broadcast.processor.ts`) reads
 * `BroadcastRecipient` rows that this service materializes via `setAudience`.
 * The worker publishes per-message payloads to the Redis `wa:broadcast`
 * channel — that contract is preserved exactly.
 */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import type { Broadcast, BroadcastStatus, Prisma } from '@wacrm/database';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUES } from '@wacrm/shared';
import {
  type BroadcastActor,
  type CreateBroadcastDto,
  type UpdateBroadcastDto,
  type ListBroadcastsFilters,
  type AudienceFilter,
  type AddBroadcastActivityInput,
} from './broadcast.types';
import { renderTemplate, hasPlaceholders } from './personalization';
import { resolveAudience, countAudience, buildAudienceWhere } from './audience';

const TERMINAL_STATUSES: BroadcastStatus[] = ['COMPLETED', 'CANCELLED', 'FAILED'];

@Injectable()
export class BroadcastService {
  constructor(@InjectQueue(QUEUES.BROADCAST) private readonly broadcastQueue: Queue) {}

  // ── Reads ────────────────────────────────────────────────────────────────

  async list(companyId: string, filters: ListBroadcastsFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, filters.limit ?? 50);
    const where = this.buildWhere(companyId, filters);
    const orderBy = this.buildOrderBy(filters.sort);

    const [items, total] = await Promise.all([
      prisma.broadcast.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
      }),
      prisma.broadcast.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async get(companyId: string, id: string) {
    const broadcast = await prisma.broadcast.findFirst({
      where: { id, companyId },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        activities: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!broadcast) throw new NotFoundException('Broadcast not found');

    // Recipient counts grouped by status (for the detail page header)
    const recipientCounts = await prisma.broadcastRecipient.groupBy({
      by: ['status'],
      where: { broadcastId: id, companyId },
      _count: { _all: true },
    });
    const countsByStatus = Object.fromEntries(
      recipientCounts.map((g) => [g.status, g._count._all]),
    );

    return { ...broadcast, countsByStatus };
  }

  async getRecipients(
    companyId: string,
    id: string,
    options: { status?: string; search?: string; page?: number; limit?: number } = {},
  ) {
    await this.ensureExists(companyId, id);
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(200, options.limit ?? 50);
    const where: Prisma.BroadcastRecipientWhereInput = { broadcastId: id, companyId };
    if (options.status) where.status = options.status as never;
    if (options.search?.trim()) {
      const q = options.search.trim();
      where.OR = [
        { toPhone: { contains: q } },
        { contact: { displayName: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.broadcastRecipient.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { queuedAt: 'asc' },
        include: { contact: { select: { id: true, displayName: true, phoneNumber: true } } },
      }),
      prisma.broadcastRecipient.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async getTimeline(companyId: string, id: string, limit = 100) {
    await this.ensureExists(companyId, id);
    return prisma.broadcastActivity.findMany({
      where: { broadcastId: id, companyId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, limit),
    });
  }

  async stats(companyId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const grouped = await prisma.broadcast.groupBy({
      by: ['status'],
      where: { companyId, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { sentCount: true, failedCount: true, deliveredCount: true, readCount: true, totalRecipients: true },
    });

    const totals = grouped.reduce(
      (acc, g) => ({
        sent: acc.sent + (g._sum.sentCount ?? 0),
        failed: acc.failed + (g._sum.failedCount ?? 0),
        delivered: acc.delivered + (g._sum.deliveredCount ?? 0),
        read: acc.read + (g._sum.readCount ?? 0),
        total: acc.total + (g._sum.totalRecipients ?? 0),
      }),
      { sent: 0, failed: 0, delivered: 0, read: 0, total: 0 },
    );

    return {
      rangeDays: days,
      byStatus: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
      sent: totals.sent,
      failed: totals.failed,
      delivered: totals.delivered,
      read: totals.read,
      total: totals.total,
      deliveryRate: totals.sent > 0 ? Math.round((totals.delivered / totals.sent) * 100) : 0,
      openRate: totals.delivered > 0 ? Math.round((totals.read / totals.delivered) * 100) : 0,
    };
  }

  async previewAudienceSize(companyId: string, filter: AudienceFilter) {
    const count = await countAudience(companyId, filter);
    const sample = await prisma.contact.findMany({
      where: buildAudienceWhere(companyId, filter),
      take: 5,
      select: { id: true, displayName: true, phoneNumber: true },
    });
    return { count, sample };
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  async create(companyId: string, dto: CreateBroadcastDto, actor: BroadcastActor): Promise<Broadcast> {
    if (!dto.name?.trim()) throw new BadRequestException('Broadcast name is required');
    if (!dto.message?.trim()) throw new BadRequestException('Broadcast message is required');

    const createdById = actor.type === 'user' ? actor.userId : null;

    const broadcast = await prisma.broadcast.create({
      data: {
        companyId,
        name: dto.name.trim(),
        message: dto.message,
        mediaUrl: dto.mediaUrl,
        mediaType: dto.mediaType,
        mediaCaption: dto.mediaCaption,
        templateName: dto.templateName,
        variables: (dto.variables ?? {}) as Prisma.InputJsonValue,
        audienceFilter: dto.audience as unknown as Prisma.InputJsonValue,
        throttleMs: dto.throttleMs ?? 2000,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        status: 'DRAFT',
        createdById,
      },
    });

    await this.logActivity(companyId, broadcast.id, actor, {
      type: 'CREATED',
      title: `Broadcast created: "${broadcast.name}"`,
      metadata: { hasMedia: !!dto.mediaUrl, scheduled: !!dto.scheduledAt },
    });

    // If audience was provided on creation, snapshot recipients now.
    if (dto.audience) {
      await this.setAudience(companyId, broadcast.id, dto.audience, actor);
    }

    // If scheduled on creation, transition straight to SCHEDULED (requires audience)
    if (dto.scheduledAt && dto.audience) {
      await this.schedule(companyId, broadcast.id, dto.scheduledAt, actor);
    }

    return broadcast;
  }

  async update(companyId: string, id: string, dto: UpdateBroadcastDto, actor: BroadcastActor): Promise<Broadcast> {
    const existing = await this.get(companyId, id);
    if (existing.status !== 'DRAFT' && existing.status !== 'SCHEDULED') {
      throw new BadRequestException(`Cannot edit a ${existing.status} broadcast`);
    }

    const data: Prisma.BroadcastUpdateInput = {};
    const changes: string[] = [];

    const set = <K extends keyof UpdateBroadcastDto>(key: K) => {
      if (dto[key] === undefined) return;
      const next = dto[key];
      const prev = (existing as unknown as Record<string, unknown>)[key as string];
      if (next !== prev) {
        (data as Record<string, unknown>)[key as string] = next;
        changes.push(String(key));
      }
    };

    set('name');
    set('message');
    set('mediaUrl');
    set('mediaType');
    set('mediaCaption');
    set('templateName');
    set('throttleMs');
    if (dto.variables !== undefined) {
      data.variables = dto.variables as Prisma.InputJsonValue;
      changes.push('variables');
    }

    if (changes.length === 0) return existing as Broadcast;

    const updated = await prisma.broadcast.update({ where: { id }, data });

    await this.logActivity(companyId, id, actor, {
      type: 'UPDATED',
      title: `Updated: ${changes.join(', ')}`,
      metadata: { fields: changes },
    });

    // If the message body changed and recipients already exist, re-render them
    // so retries pick up the new text.
    if (changes.includes('message') && existing.totalRecipients > 0) {
      await this.rerenderRecipients(companyId, id, updated.message, (updated.variables ?? {}) as Record<string, string>);
    }

    return updated;
  }

  /**
   * Replace the broadcast's audience. Resolves the filter into a list of
   * contacts and snapshots them as `BroadcastRecipient` rows. Skips
   * opted-out / blocked / no-phone with status SKIPPED. Only allowed in
   * DRAFT — for SCHEDULED you must `unschedule` first.
   */
  async setAudience(
    companyId: string,
    id: string,
    filter: AudienceFilter,
    actor: BroadcastActor,
  ): Promise<{ totalRecipients: number; skippedCount: number }> {
    const broadcast = await this.get(companyId, id);
    if (broadcast.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot change audience of a ${broadcast.status} broadcast — unschedule first`);
    }

    // Wipe existing recipients
    await prisma.broadcastRecipient.deleteMany({ where: { broadcastId: id } });

    // Resolve the audience
    const contacts = await resolveAudience(companyId, filter);
    const variables = (broadcast.variables ?? {}) as Record<string, string>;
    const willPersonalize = hasPlaceholders(broadcast.message);

    // Snapshot recipients with rendered text
    let totalRecipients = 0;
    const data: Prisma.BroadcastRecipientCreateManyInput[] = [];
    for (const c of contacts) {
      if (!c.phoneNumber) continue;
      data.push({
        broadcastId: id,
        companyId,
        contactId: c.id,
        toPhone: c.phoneNumber,
        renderedText: willPersonalize
          ? renderTemplate(broadcast.message, c, variables)
          : broadcast.message,
        mediaUrl: broadcast.mediaUrl,
        status: 'QUEUED',
      });
      totalRecipients++;
    }

    if (data.length > 0) {
      await prisma.broadcastRecipient.createMany({ data, skipDuplicates: true });
    }

    // Update broadcast counts
    const updated = await prisma.broadcast.update({
      where: { id },
      data: {
        audienceFilter: filter as unknown as Prisma.InputJsonValue,
        totalRecipients,
        totalCount: totalRecipients, // legacy alias
        sentCount: 0,
        failedCount: 0,
        deliveredCount: 0,
        readCount: 0,
        skippedCount: 0,
        targetTags: filter.tags ?? [],
        targetContactIds: filter.contactIds ?? [],
      },
    });

    await this.logActivity(companyId, id, actor, {
      type: 'AUDIENCE_CHANGED',
      title: `Audience set — ${totalRecipients} recipient${totalRecipients === 1 ? '' : 's'}`,
      metadata: { filter, totalRecipients },
    });

    return { totalRecipients: updated.totalRecipients, skippedCount: 0 };
  }

  async schedule(
    companyId: string,
    id: string,
    scheduledAt: string | Date,
    actor: BroadcastActor,
  ): Promise<Broadcast> {
    const broadcast = await this.get(companyId, id);
    if (broadcast.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot schedule a ${broadcast.status} broadcast`);
    }
    if (broadcast.totalRecipients === 0) {
      throw new BadRequestException('Set the audience before scheduling');
    }

    const at = new Date(scheduledAt);
    const updated = await prisma.broadcast.update({
      where: { id },
      data: { status: 'SCHEDULED', scheduledAt: at },
    });

    // The scheduler worker will pick this up at `at`. We don't enqueue
    // anything here — the BullMQ delayed job approach is fragile across
    // restarts. Instead the scheduler scans the DB every minute.

    await this.logActivity(companyId, id, actor, {
      type: 'SCHEDULED',
      title: `Scheduled for ${at.toISOString()}`,
      metadata: { scheduledAt: at },
    });

    return updated;
  }

  async unschedule(companyId: string, id: string, actor: BroadcastActor): Promise<Broadcast> {
    const broadcast = await this.get(companyId, id);
    if (broadcast.status !== 'SCHEDULED') {
      throw new BadRequestException(`Broadcast is not scheduled`);
    }

    const updated = await prisma.broadcast.update({
      where: { id },
      data: { status: 'DRAFT', scheduledAt: null },
    });

    await this.logActivity(companyId, id, actor, {
      type: 'UPDATED',
      title: 'Unscheduled — back to DRAFT',
    });

    return updated;
  }

  async sendNow(companyId: string, id: string, actor: BroadcastActor): Promise<Broadcast> {
    const broadcast = await this.get(companyId, id);
    if (broadcast.status !== 'DRAFT' && broadcast.status !== 'SCHEDULED') {
      throw new BadRequestException(`Cannot send a ${broadcast.status} broadcast`);
    }
    if (broadcast.totalRecipients === 0) {
      throw new BadRequestException('Set the audience before sending');
    }

    const updated = await prisma.broadcast.update({
      where: { id },
      data: { status: 'SENDING', startedAt: new Date(), scheduledAt: null },
    });

    // Enqueue to the worker immediately. The worker will mark each recipient as it goes.
    await this.broadcastQueue.add(
      'send-broadcast',
      { broadcastId: id, companyId },
      { jobId: `broadcast-${id}-${Date.now()}` },
    );

    await this.logActivity(companyId, id, actor, {
      type: 'STARTED',
      title: 'Send started',
    });

    return updated;
  }

  async pause(companyId: string, id: string, actor: BroadcastActor): Promise<Broadcast> {
    const broadcast = await this.get(companyId, id);
    if (broadcast.status !== 'SENDING') {
      throw new BadRequestException(`Can only pause a SENDING broadcast (was ${broadcast.status})`);
    }
    const updated = await prisma.broadcast.update({
      where: { id },
      data: { status: 'PAUSED' },
    });
    await this.logActivity(companyId, id, actor, { type: 'PAUSED', title: 'Paused' });
    return updated;
  }

  async resume(companyId: string, id: string, actor: BroadcastActor): Promise<Broadcast> {
    const broadcast = await this.get(companyId, id);
    if (broadcast.status !== 'PAUSED') {
      throw new BadRequestException(`Can only resume a PAUSED broadcast (was ${broadcast.status})`);
    }
    const updated = await prisma.broadcast.update({
      where: { id },
      data: { status: 'SENDING' },
    });
    await this.broadcastQueue.add(
      'send-broadcast',
      { broadcastId: id, companyId },
      { jobId: `broadcast-${id}-${Date.now()}` },
    );
    await this.logActivity(companyId, id, actor, { type: 'RESUMED', title: 'Resumed' });
    return updated;
  }

  async cancel(companyId: string, id: string, actor: BroadcastActor): Promise<Broadcast> {
    const broadcast = await this.get(companyId, id);
    if (TERMINAL_STATUSES.includes(broadcast.status)) {
      throw new BadRequestException(`Cannot cancel a ${broadcast.status} broadcast`);
    }

    const updated = await prisma.broadcast.update({
      where: { id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });

    // Mark all still-queued recipients as SKIPPED
    const skipped = await prisma.broadcastRecipient.updateMany({
      where: { broadcastId: id, status: 'QUEUED' },
      data: { status: 'SKIPPED' },
    });
    if (skipped.count > 0) {
      await prisma.broadcast.update({
        where: { id },
        data: { skippedCount: { increment: skipped.count } },
      });
    }

    await this.logActivity(companyId, id, actor, {
      type: 'CANCELLED',
      title: `Cancelled — ${skipped.count} recipient${skipped.count === 1 ? '' : 's'} skipped`,
    });

    return updated;
  }

  async retryFailed(companyId: string, id: string, actor: BroadcastActor): Promise<Broadcast> {
    // Verify broadcast exists
    await this.ensureExists(companyId, id);

    const reset = await prisma.broadcastRecipient.updateMany({
      where: { broadcastId: id, status: 'FAILED' },
      data: { status: 'QUEUED', errorMessage: null, failedAt: null },
    });

    if (reset.count === 0) {
      throw new BadRequestException('No failed recipients to retry');
    }

    // If broadcast is in a terminal state, reopen it
    const updated = await prisma.broadcast.update({
      where: { id },
      data: {
        status: 'SENDING',
        failedCount: { decrement: reset.count },
        completedAt: null,
      },
    });

    await this.broadcastQueue.add(
      'send-broadcast',
      { broadcastId: id, companyId },
      { jobId: `broadcast-${id}-retry-${Date.now()}` },
    );

    await this.logActivity(companyId, id, actor, {
      type: 'RETRY_FAILED',
      title: `Retrying ${reset.count} failed recipient${reset.count === 1 ? '' : 's'}`,
      metadata: { count: reset.count },
    });

    return updated;
  }

  async duplicate(companyId: string, id: string, actor: BroadcastActor, newName?: string): Promise<Broadcast> {
    const source = await this.get(companyId, id);
    return this.create(
      companyId,
      {
        name: newName ?? `${source.name} (copy)`,
        message: source.message,
        mediaUrl: source.mediaUrl ?? undefined,
        mediaType: source.mediaType ?? undefined,
        mediaCaption: source.mediaCaption ?? undefined,
        templateName: source.templateName ?? undefined,
        variables: (source.variables ?? {}) as Record<string, string>,
        throttleMs: source.throttleMs,
      },
      actor,
    );
  }

  async delete(companyId: string, id: string, actor: BroadcastActor) {
    const existing = await this.get(companyId, id);
    if (existing.status === 'SENDING') {
      throw new BadRequestException('Cancel the broadcast before deleting');
    }
    await this.logActivity(companyId, id, actor, {
      type: 'CUSTOM',
      title: `Deleted broadcast "${existing.name}"`,
    });
    return prisma.broadcast.delete({ where: { id } });
  }

  // ── Worker-facing helpers ───────────────────────────────────────────────

  async addActivity(companyId: string, id: string, input: AddBroadcastActivityInput, actor: BroadcastActor) {
    return this.logActivity(companyId, id, actor, input);
  }

  /**
   * Find broadcasts whose `scheduledAt` has elapsed and that haven't been
   * picked up yet. Used by the scheduler worker every minute.
   */
  async findDueScheduled(): Promise<Array<{ id: string; companyId: string }>> {
    return prisma.broadcast.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { lte: new Date() },
      },
      select: { id: true, companyId: true },
      take: 100,
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async ensureExists(companyId: string, id: string) {
    const found = await prisma.broadcast.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Broadcast not found');
  }

  private async rerenderRecipients(
    companyId: string,
    broadcastId: string,
    template: string,
    variables: Record<string, string>,
  ) {
    const recipients = await prisma.broadcastRecipient.findMany({
      where: { broadcastId, companyId, status: { in: ['QUEUED', 'FAILED'] } },
      include: { contact: true },
      take: 5000,
    });
    for (const r of recipients) {
      const rendered = renderTemplate(template, r.contact, variables);
      if (rendered !== r.renderedText) {
        await prisma.broadcastRecipient.update({
          where: { id: r.id },
          data: { renderedText: rendered },
        });
      }
    }
  }

  private buildWhere(companyId: string, f: ListBroadcastsFilters): Prisma.BroadcastWhereInput {
    const where: Prisma.BroadcastWhereInput = { companyId };
    if (f.status) where.status = Array.isArray(f.status) ? { in: f.status } : f.status;
    if (f.scheduledFrom || f.scheduledTo) {
      where.scheduledAt = {};
      if (f.scheduledFrom) where.scheduledAt.gte = new Date(f.scheduledFrom);
      if (f.scheduledTo) where.scheduledAt.lte = new Date(f.scheduledTo);
    }
    if (f.search?.trim()) {
      const q = f.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { message: { contains: q, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private buildOrderBy(sort?: ListBroadcastsFilters['sort']): Prisma.BroadcastOrderByWithRelationInput {
    switch (sort) {
      case 'name': return { name: 'asc' };
      case 'scheduled': return { scheduledAt: 'asc' };
      case 'sent_count': return { sentCount: 'desc' };
      case 'recent':
      default: return { createdAt: 'desc' };
    }
  }

  private async logActivity(
    companyId: string,
    broadcastId: string,
    actor: BroadcastActor,
    input: AddBroadcastActivityInput,
  ) {
    return prisma.broadcastActivity.create({
      data: {
        broadcastId,
        companyId,
        type: input.type,
        actorType: actor.type,
        actorId: actor.type === 'user' ? actor.userId : null,
        title: input.title,
        body: input.body,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
