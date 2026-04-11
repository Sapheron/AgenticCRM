/**
 * Campaigns service — single write path for every campaign mutation.
 *
 * Every method that changes state goes through `logActivity` so we get a
 * complete audit trail in `CampaignActivity` attributed to the original
 * actor (user / ai / system / worker).
 *
 * Send modes:
 *   DIRECT    — this service snapshots recipients, flips to SENDING, and
 *               the worker's campaign-send processor drains the recipient
 *               table at the configured throttle.
 *   BROADCAST — launch() creates a Broadcast row via the Broadcast module,
 *               then tracks its lifecycle via the campaign's broadcastId.
 *   SEQUENCE  — launch() enrols each resolved contact into the referenced
 *               Sequence and records the enrollment ids on the recipients.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma } from '@wacrm/database';
import type {
  Prisma,
  Campaign,
  CampaignStatus,
  CampaignChannel,
  CampaignSendMode,
  CampaignRecipient,
  CampaignRecipientStatus,
} from '@wacrm/database';

import {
  resolveAudience,
  type ContactSnap,
  type ResolvedAudience,
} from './campaigns.audience';
import type {
  CampaignActor,
  CampaignAudienceFilter,
  CreateCampaignDto,
  UpdateCampaignDto,
  ListCampaignsFilters,
  ListRecipientsFilters,
  AddCampaignActivityInput,
  CampaignStatsSnapshot,
  AudiencePreview,
  BulkMutationResult,
} from './campaigns.types';

const TERMINAL_RECIPIENT_STATUSES: CampaignRecipientStatus[] = [
  'SENT',
  'DELIVERED',
  'READ',
  'REPLIED',
  'FAILED',
  'SKIPPED',
  'OPTED_OUT',
];

@Injectable()
export class CampaignsService {
  // ── Reads ─────────────────────────────────────────────────────────────────

  async list(companyId: string, filters: ListCampaignsFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    const where: Prisma.CampaignWhereInput = { companyId };

    if (filters.status) {
      where.status = Array.isArray(filters.status)
        ? { in: filters.status }
        : filters.status;
    }
    if (filters.channel) {
      where.channel = Array.isArray(filters.channel)
        ? { in: filters.channel }
        : filters.channel;
    }
    if (filters.sendMode) {
      where.sendMode = Array.isArray(filters.sendMode)
        ? { in: filters.sendMode }
        : filters.sendMode;
    }
    if (filters.priority) {
      where.priority = Array.isArray(filters.priority)
        ? { in: filters.priority }
        : filters.priority;
    }
    if (filters.tag) where.tags = { has: filters.tag };
    if (filters.startFrom || filters.startTo) {
      where.startAt = {};
      if (filters.startFrom) (where.startAt as Prisma.DateTimeFilter).gte = new Date(filters.startFrom);
      if (filters.startTo) (where.startAt as Prisma.DateTimeFilter).lte = new Date(filters.startTo);
    }
    if (filters.createdFrom || filters.createdTo) {
      where.createdAt = {};
      if (filters.createdFrom) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(filters.createdFrom);
      if (filters.createdTo) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(filters.createdTo);
    }
    if (filters.search) {
      const q = filters.search;
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { notes: { contains: q, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.CampaignOrderByWithRelationInput =
      filters.sort === 'scheduled'
        ? { startAt: 'asc' }
        : filters.sort === 'name'
          ? { name: 'asc' }
          : filters.sort === 'progress'
            ? { sentCount: 'desc' }
            : { createdAt: 'desc' };

    const [items, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.campaign.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async get(companyId: string, id: string) {
    const record = await prisma.campaign.findFirst({
      where: { id, companyId },
      include: {
        activities: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!record) throw new NotFoundException('Campaign not found');
    return record;
  }

  async getTimeline(companyId: string, id: string, limit = 100) {
    await this.getRaw(companyId, id);
    return prisma.campaignActivity.findMany({
      where: { campaignId: id, companyId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, Math.max(1, limit)),
    });
  }

  async listRecipients(
    companyId: string,
    id: string,
    filters: ListRecipientsFilters = {},
  ) {
    await this.getRaw(companyId, id);
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(500, Math.max(1, filters.limit ?? 100));
    const where: Prisma.CampaignRecipientWhereInput = {
      campaignId: id,
      companyId,
    };
    if (filters.status) {
      where.status = Array.isArray(filters.status)
        ? { in: filters.status }
        : filters.status;
    }
    const [items, total] = await Promise.all([
      prisma.campaignRecipient.findMany({
        where,
        orderBy: { queuedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.campaignRecipient.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async stats(companyId: string, days = 30): Promise<CampaignStatsSnapshot> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const campaigns = await prisma.campaign.findMany({
      where: { companyId, createdAt: { gte: since } },
      select: {
        status: true,
        sentCount: true,
        deliveredCount: true,
        repliedCount: true,
        failedCount: true,
      },
    });

    const byStatus: Record<string, number> = {};
    let totalSent = 0;
    let totalDelivered = 0;
    let totalReplied = 0;
    let totalFailed = 0;
    for (const c of campaigns) {
      byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
      totalSent += c.sentCount;
      totalDelivered += c.deliveredCount;
      totalReplied += c.repliedCount;
      totalFailed += c.failedCount;
    }

    return {
      rangeDays: days,
      totalCampaigns: campaigns.length,
      byStatus,
      activeCampaigns: (byStatus['SENDING'] ?? 0) + (byStatus['PAUSED'] ?? 0),
      scheduledCampaigns: byStatus['SCHEDULED'] ?? 0,
      completedCampaigns: byStatus['COMPLETED'] ?? 0,
      totalSent,
      totalDelivered,
      totalReplied,
      totalFailed,
      replyRate: totalSent > 0 ? Math.round((totalReplied / totalSent) * 1000) / 10 : null,
      deliveryRate: totalSent > 0 ? Math.round((totalDelivered / totalSent) * 1000) / 10 : null,
    };
  }

  // ── Writes (every one attributes an actor and logs activity) ─────────────

  async create(
    companyId: string,
    actor: CampaignActor,
    dto: CreateCampaignDto,
  ): Promise<Campaign> {
    if (!dto.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    const campaign = await prisma.campaign.create({
      data: {
        companyId,
        name: dto.name.trim(),
        description: dto.description,
        channel: dto.channel ?? 'WHATSAPP',
        sendMode: dto.sendMode ?? 'DIRECT',
        templateId: dto.templateId,
        sequenceId: dto.sequenceId,
        priority: dto.priority ?? 'MEDIUM',
        tags: dto.tags ?? [],
        budget: dto.budget,
        throttleMs: dto.throttleMs ?? 2000,
        notes: dto.notes,
        audienceTags: dto.audience?.tags ?? [],
        audienceContactIds: dto.audience?.contactIds ?? [],
        audienceOptOutBehavior: dto.audience?.optOutBehavior ?? 'skip',
        createdByUserId: actor.type === 'user' ? actor.userId : null,
      },
    });
    await this.logActivity(companyId, campaign.id, actor, {
      type: 'CREATED',
      title: `Campaign "${campaign.name}" created`,
      metadata: { channel: campaign.channel, sendMode: campaign.sendMode },
    });
    return campaign;
  }

  async update(
    companyId: string,
    id: string,
    actor: CampaignActor,
    dto: UpdateCampaignDto,
  ): Promise<Campaign> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status !== 'DRAFT' && existing.status !== 'SCHEDULED') {
      throw new BadRequestException(
        `Cannot edit a campaign in status ${existing.status}. Pause or cancel it first.`,
      );
    }
    const data: Prisma.CampaignUpdateInput = {};
    const diffs: Array<{ field: string; from: unknown; to: unknown }> = [];
    const assign = <K extends keyof UpdateCampaignDto>(
      field: K,
      dbField: keyof Prisma.CampaignUpdateInput,
    ) => {
      if (dto[field] === undefined) return;
      const newVal = dto[field];
      const oldVal = (existing as unknown as Record<string, unknown>)[field as string];
      if (newVal !== oldVal) {
        diffs.push({ field: field as string, from: oldVal, to: newVal });
        (data as Record<string, unknown>)[dbField as string] = newVal;
      }
    };
    assign('name', 'name');
    assign('description', 'description');
    assign('channel', 'channel');
    assign('sendMode', 'sendMode');
    assign('templateId', 'templateId');
    assign('sequenceId', 'sequenceId');
    assign('priority', 'priority');
    assign('tags', 'tags');
    assign('budget', 'budget');
    assign('throttleMs', 'throttleMs');
    assign('notes', 'notes');

    if (diffs.length === 0) return existing;

    const updated = await prisma.campaign.update({ where: { id }, data });
    for (const d of diffs) {
      await this.logActivity(companyId, id, actor, {
        type: 'FIELD_UPDATED',
        title: `${d.field} updated`,
        body: `${safeDisplay(d.from)} → ${safeDisplay(d.to)}`,
        metadata: { field: d.field, from: d.from, to: d.to },
      });
    }
    return updated;
  }

  async setAudience(
    companyId: string,
    id: string,
    actor: CampaignActor,
    filter: CampaignAudienceFilter,
  ): Promise<Campaign> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status !== 'DRAFT' && existing.status !== 'SCHEDULED') {
      throw new BadRequestException(
        `Cannot change audience in status ${existing.status}`,
      );
    }
    const updated = await prisma.campaign.update({
      where: { id },
      data: {
        audienceTags: filter.tags ?? [],
        audienceContactIds: filter.contactIds ?? [],
        audienceOptOutBehavior: filter.optOutBehavior ?? 'skip',
      },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'AUDIENCE_UPDATED',
      title: 'Audience filter updated',
      metadata: {
        tags: filter.tags ?? [],
        contactIds: filter.contactIds ?? [],
      },
    });
    return updated;
  }

  async previewAudience(
    companyId: string,
    id: string,
  ): Promise<AudiencePreview> {
    const campaign = await this.getRaw(companyId, id);
    const resolved = await this.resolveCampaignAudience(campaign);
    const sampleContacts = await prisma.contact.findMany({
      where: { id: { in: resolved.contactIds.slice(0, 10) } },
      select: { id: true, displayName: true, phoneNumber: true },
    });
    return {
      totalMatch: resolved.totalMatch,
      optedOut: resolved.optedOutContactIds.length,
      netDeliverable: resolved.contactIds.length,
      sampleContacts,
    };
  }

  async schedule(
    companyId: string,
    id: string,
    actor: CampaignActor,
    startAt: Date | string,
  ): Promise<Campaign> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(
        `Only DRAFT campaigns can be scheduled (current: ${existing.status})`,
      );
    }
    this.assertLaunchable(existing);
    const when = new Date(startAt);
    if (!Number.isFinite(when.getTime())) {
      throw new BadRequestException('Invalid startAt');
    }
    const updated = await prisma.campaign.update({
      where: { id },
      data: { status: 'SCHEDULED', startAt: when },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'SCHEDULED',
      title: `Scheduled for ${when.toISOString()}`,
      metadata: { startAt: when.toISOString() },
    });
    return updated;
  }

  /**
   * Launch a campaign — resolves audience, snapshots recipients, flips to SENDING.
   * Returns the updated campaign plus resolution stats so the caller/AI can
   * relay them to the user.
   */
  async launch(
    companyId: string,
    id: string,
    actor: CampaignActor,
  ): Promise<{ campaign: Campaign; resolved: ResolvedAudience }> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status !== 'DRAFT' && existing.status !== 'SCHEDULED') {
      throw new BadRequestException(
        `Cannot launch a campaign in status ${existing.status}`,
      );
    }
    this.assertLaunchable(existing);

    const resolved = await this.resolveCampaignAudience(existing);
    if (resolved.contactIds.length === 0 && resolved.optedOutContactIds.length === 0) {
      throw new BadRequestException(
        'Resolved audience is empty. Add tags or contact ids before launching.',
      );
    }

    // Snapshot recipients + flip status atomically.
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      // Build recipient rows
      const pendingRows = resolved.contactIds.map((cid) => ({
        id: undefined,
        campaignId: id,
        companyId,
        contactId: cid,
        status: 'PENDING' as CampaignRecipientStatus,
        queuedAt: now,
      }));
      const optedOutRows =
        existing.audienceOptOutBehavior === 'fail'
          ? resolved.optedOutContactIds.map((cid) => ({
              id: undefined,
              campaignId: id,
              companyId,
              contactId: cid,
              status: 'OPTED_OUT' as CampaignRecipientStatus,
              queuedAt: now,
            }))
          : [];

      if (pendingRows.length > 0 || optedOutRows.length > 0) {
        await tx.campaignRecipient.createMany({
          data: [...pendingRows, ...optedOutRows].map(({ id: _omit, ...r }) => r),
          skipDuplicates: true,
        });
      }

      await tx.campaign.update({
        where: { id },
        data: {
          status: 'SENDING',
          startedAt: now,
          totalRecipients: pendingRows.length + optedOutRows.length,
          optedOutCount: optedOutRows.length,
        },
      });
    });

    await this.logActivity(companyId, id, actor, {
      type: 'LAUNCHED',
      title: `Launched — ${resolved.contactIds.length} recipients queued`,
      body:
        resolved.optedOutContactIds.length > 0
          ? `${resolved.optedOutContactIds.length} opted-out contacts ${
              existing.audienceOptOutBehavior === 'fail' ? 'marked OPTED_OUT' : 'silently skipped'
            }`
          : undefined,
      metadata: {
        sendMode: existing.sendMode,
        totalMatch: resolved.totalMatch,
        deliverable: resolved.contactIds.length,
        optedOut: resolved.optedOutContactIds.length,
      },
    });

    // SendMode-specific dispatch. BROADCAST/SEQUENCE dispatch is stubbed with
    // activity rows for now — the dedicated hook wiring lives in step 8/9.
    if (existing.sendMode === 'BROADCAST') {
      await this.logActivity(companyId, id, actor, {
        type: 'BROADCAST_DISPATCHED',
        title: 'Broadcast dispatch requested',
        body: 'A linked Broadcast record will be created by the worker.',
      });
    } else if (existing.sendMode === 'SEQUENCE') {
      await this.logActivity(companyId, id, actor, {
        type: 'SEQUENCE_ENROLLED',
        title: 'Sequence enrollment requested',
        metadata: { sequenceId: existing.sequenceId },
      });
    }

    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id } });
    return { campaign, resolved };
  }

  async pause(companyId: string, id: string, actor: CampaignActor): Promise<Campaign> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status !== 'SENDING') {
      throw new BadRequestException(
        `Only SENDING campaigns can be paused (current: ${existing.status})`,
      );
    }
    const updated = await prisma.campaign.update({
      where: { id },
      data: { status: 'PAUSED', pausedAt: new Date() },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'PAUSED',
      title: 'Paused',
    });
    return updated;
  }

  async resume(companyId: string, id: string, actor: CampaignActor): Promise<Campaign> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status !== 'PAUSED') {
      throw new BadRequestException(
        `Only PAUSED campaigns can be resumed (current: ${existing.status})`,
      );
    }
    const updated = await prisma.campaign.update({
      where: { id },
      data: { status: 'SENDING', pausedAt: null },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'RESUMED',
      title: 'Resumed',
    });
    return updated;
  }

  async cancel(
    companyId: string,
    id: string,
    actor: CampaignActor,
    reason?: string,
  ): Promise<Campaign> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      throw new BadRequestException(`Campaign is already ${existing.status}`);
    }
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.campaign.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
      // Mark pending recipients as SKIPPED so the send processor ignores them.
      await tx.campaignRecipient.updateMany({
        where: { campaignId: id, status: { in: ['PENDING', 'QUEUED'] } },
        data: { status: 'SKIPPED', failedAt: now, errorReason: 'campaign cancelled' },
      });
    });
    await this.logActivity(companyId, id, actor, {
      type: 'CANCELLED',
      title: 'Cancelled',
      body: reason,
      metadata: { reason },
    });
    return (await prisma.campaign.findUniqueOrThrow({ where: { id } }));
  }

  async complete(
    companyId: string,
    id: string,
    actor: CampaignActor,
  ): Promise<Campaign> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status !== 'SENDING') {
      return existing; // idempotent — only transition once from SENDING
    }
    const updated = await prisma.campaign.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'COMPLETED',
      title: 'Completed',
      metadata: {
        sent: updated.sentCount,
        delivered: updated.deliveredCount,
        replied: updated.repliedCount,
        failed: updated.failedCount,
      },
    });
    return updated;
  }

  async duplicate(
    companyId: string,
    id: string,
    actor: CampaignActor,
  ): Promise<Campaign> {
    const src = await this.getRaw(companyId, id);
    const dup = await prisma.campaign.create({
      data: {
        companyId,
        name: `${src.name} (copy)`,
        description: src.description,
        channel: src.channel,
        sendMode: src.sendMode,
        templateId: src.templateId,
        sequenceId: src.sequenceId,
        priority: src.priority,
        tags: src.tags,
        budget: src.budget,
        throttleMs: src.throttleMs,
        notes: src.notes,
        audienceTags: src.audienceTags,
        audienceContactIds: src.audienceContactIds,
        audienceOptOutBehavior: src.audienceOptOutBehavior,
        createdByUserId: actor.type === 'user' ? actor.userId : null,
      },
    });
    await this.logActivity(companyId, dup.id, actor, {
      type: 'CREATED',
      title: `Duplicated from "${src.name}"`,
      metadata: { sourceCampaignId: src.id },
    });
    return dup;
  }

  async addNote(
    companyId: string,
    id: string,
    actor: CampaignActor,
    body: string,
  ): Promise<void> {
    await this.getRaw(companyId, id);
    if (!body?.trim()) throw new BadRequestException('note body required');
    await this.logActivity(companyId, id, actor, {
      type: 'NOTE_ADDED',
      title: 'Note',
      body: body.trim(),
    });
  }

  async remove(companyId: string, id: string): Promise<void> {
    const existing = await this.getRaw(companyId, id);
    if (
      existing.status !== 'DRAFT' &&
      existing.status !== 'CANCELLED' &&
      existing.status !== 'COMPLETED'
    ) {
      throw new BadRequestException(
        `Cannot delete a campaign in status ${existing.status}. Cancel it first.`,
      );
    }
    await prisma.campaign.delete({ where: { id } });
  }

  // ── Bulk ops ──────────────────────────────────────────────────────────────

  async bulkPause(
    companyId: string,
    ids: string[],
    actor: CampaignActor,
  ): Promise<BulkMutationResult> {
    return this.runBulk(ids, (id) => this.pause(companyId, id, actor));
  }

  async bulkResume(
    companyId: string,
    ids: string[],
    actor: CampaignActor,
  ): Promise<BulkMutationResult> {
    return this.runBulk(ids, (id) => this.resume(companyId, id, actor));
  }

  async bulkCancel(
    companyId: string,
    ids: string[],
    actor: CampaignActor,
    reason?: string,
  ): Promise<BulkMutationResult> {
    return this.runBulk(ids, (id) => this.cancel(companyId, id, actor, reason));
  }

  async bulkDelete(
    companyId: string,
    ids: string[],
  ): Promise<BulkMutationResult> {
    return this.runBulk(ids, (id) => this.remove(companyId, id));
  }

  // ── Recipient event recording (called by worker + whatsapp hooks) ───────

  /**
   * Advance a recipient's FSM and bump the campaign counters.
   * Safe to call multiple times with the same event — idempotent against
   * the current status (e.g. DELIVERED → READ is allowed but READ → DELIVERED is a no-op).
   */
  async recordRecipientEvent(
    recipientId: string,
    event: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'REPLIED' | 'FAILED',
    metadata?: { errorReason?: string; messageId?: string },
  ): Promise<CampaignRecipient | null> {
    const row = await prisma.campaignRecipient.findUnique({
      where: { id: recipientId },
      include: { campaign: { select: { id: true, companyId: true, status: true, sentCount: true, deliveredCount: true, readCount: true, repliedCount: true, failedCount: true, totalRecipients: true } } },
    });
    if (!row) return null;

    // Check ordering — don't downgrade.
    const rank: Record<CampaignRecipientStatus, number> = {
      PENDING: 0,
      QUEUED: 1,
      SENT: 2,
      DELIVERED: 3,
      READ: 4,
      REPLIED: 5,
      FAILED: 6,
      SKIPPED: 7,
      OPTED_OUT: 8,
    };
    const nextStatus = event as CampaignRecipientStatus;
    if (rank[nextStatus] <= rank[row.status] && event !== 'REPLIED') {
      return row;
    }

    const now = new Date();
    const data: Prisma.CampaignRecipientUpdateInput = { status: nextStatus };
    const campaignCounterDiff: Prisma.CampaignUpdateInput = {};
    switch (event) {
      case 'QUEUED':
        data.queuedAt = now;
        break;
      case 'SENT':
        data.sentAt = now;
        if (metadata?.messageId) data.messageId = metadata.messageId;
        campaignCounterDiff.sentCount = { increment: 1 };
        break;
      case 'DELIVERED':
        data.deliveredAt = now;
        campaignCounterDiff.deliveredCount = { increment: 1 };
        break;
      case 'READ':
        data.readAt = now;
        campaignCounterDiff.readCount = { increment: 1 };
        break;
      case 'REPLIED':
        data.repliedAt = now;
        campaignCounterDiff.repliedCount = { increment: 1 };
        break;
      case 'FAILED':
        data.failedAt = now;
        data.errorReason = metadata?.errorReason;
        campaignCounterDiff.failedCount = { increment: 1 };
        break;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const r = await tx.campaignRecipient.update({
        where: { id: recipientId },
        data,
      });
      if (Object.keys(campaignCounterDiff).length > 0) {
        await tx.campaign.update({
          where: { id: row.campaign.id },
          data: campaignCounterDiff,
        });
      }
      return r;
    });

    // Drop a per-event activity row (worker actor).
    const activityType =
      event === 'SENT' ? 'RECIPIENT_SENT'
      : event === 'DELIVERED' ? 'RECIPIENT_DELIVERED'
      : event === 'READ' ? 'RECIPIENT_READ'
      : event === 'REPLIED' ? 'RECIPIENT_REPLIED'
      : event === 'FAILED' ? 'RECIPIENT_FAILED'
      : null;
    if (activityType) {
      await this.logActivity(row.campaign.companyId, row.campaign.id, { type: 'worker' }, {
        type: activityType,
        title: `Recipient ${event.toLowerCase()}`,
        metadata: { recipientId, contactId: row.contactId },
      });
    }

    // Auto-complete the campaign when every non-skipped recipient is terminal.
    if (row.campaign.status === 'SENDING') {
      const pending = await prisma.campaignRecipient.count({
        where: {
          campaignId: row.campaign.id,
          status: { notIn: TERMINAL_RECIPIENT_STATUSES },
        },
      });
      if (pending === 0) {
        await this.complete(row.campaign.companyId, row.campaign.id, { type: 'worker' });
      }
    }

    return updated;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  async findDueForLaunch(now: Date = new Date()): Promise<Campaign[]> {
    return prisma.campaign.findMany({
      where: {
        status: 'SCHEDULED',
        startAt: { lte: now },
      },
      take: 50,
      orderBy: { startAt: 'asc' },
    });
  }

  /** Raw get — used internally to avoid the includes that `get` does. */
  private async getRaw(companyId: string, id: string): Promise<Campaign> {
    const record = await prisma.campaign.findFirst({ where: { id, companyId } });
    if (!record) throw new NotFoundException('Campaign not found');
    return record;
  }

  private assertLaunchable(c: Campaign): void {
    const hasAudience =
      (c.audienceTags?.length ?? 0) > 0 || (c.audienceContactIds?.length ?? 0) > 0;
    if (!hasAudience) {
      throw new BadRequestException(
        'Campaign has no audience — set tags or contact ids first.',
      );
    }
    if (c.sendMode === 'DIRECT' && !c.templateId) {
      throw new BadRequestException('DIRECT-mode campaigns require a templateId');
    }
    if (c.sendMode === 'SEQUENCE' && !c.sequenceId) {
      throw new BadRequestException('SEQUENCE-mode campaigns require a sequenceId');
    }
  }

  private async resolveCampaignAudience(c: Campaign): Promise<ResolvedAudience> {
    // Load every candidate contact. For small-mid tenants this is cheap; if
    // it becomes a bottleneck we can push tag/opt-out filters down into SQL.
    const contacts = await prisma.contact.findMany({
      where: {
        companyId: c.companyId,
        OR: [
          { tags: { hasSome: c.audienceTags } },
          { id: { in: c.audienceContactIds } },
        ],
      },
      select: { id: true, tags: true, optedOut: true, isBlocked: true },
    });
    const snaps: ContactSnap[] = contacts.map((c2) => ({
      id: c2.id,
      tags: c2.tags,
      optedOut: c2.optedOut,
      isBlocked: c2.isBlocked,
    }));
    return resolveAudience(snaps, {
      tags: c.audienceTags,
      contactIds: c.audienceContactIds,
      optOutBehavior: c.audienceOptOutBehavior as 'skip' | 'fail',
    });
  }

  private async runBulk(
    ids: string[],
    op: (id: string) => Promise<unknown>,
  ): Promise<BulkMutationResult> {
    let updated = 0;
    let failed = 0;
    const errors: Array<{ id: string; reason: string }> = [];
    for (const id of ids) {
      try {
        await op(id);
        updated++;
      } catch (err) {
        failed++;
        errors.push({
          id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { updated, failed, errors };
  }

  private async logActivity(
    companyId: string,
    campaignId: string,
    actor: CampaignActor,
    input: AddCampaignActivityInput,
  ) {
    return prisma.campaignActivity.create({
      data: {
        campaignId,
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

// ── Local helpers ───────────────────────────────────────────────────────────

function safeDisplay(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.join(', ') || '[]';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// Suppress unused enum imports that exist for downstream type inference
const _TYPE_GUARD: Array<CampaignStatus | CampaignChannel | CampaignSendMode> = [];
void _TYPE_GUARD;
