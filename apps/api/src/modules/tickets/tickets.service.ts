/**
 * Tickets service — single write path for every ticket mutation.
 *
 * Mirrors the pattern used for Leads / Deals / Invoices: every
 * state-changing method ends with `logActivity` so we get a complete
 * audit trail in `TicketActivity` attributed to the original actor
 * (user/ai/system/worker/customer).
 *
 * Support-specific features: comments (public + internal), SLA tracking,
 * assign/escalate/merge, reopen. The SLA due dates are stamped on
 * creation if a matching SlaPolicy exists, and breach flags are set
 * lazily when the ticket is read or when a worker job checks overdue
 * tickets (deferred to a future ticket-cycle processor).
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma } from '@wacrm/database';
import type {
  Prisma,
  Ticket,
  TicketComment,
  TicketActivityType,
  TicketStatus,
} from '@wacrm/database';

import { computeSlaDue, generateTicketNumber, isBreached } from './tickets.sla';
import type {
  AddTicketActivityInput,
  BulkMutationResult,
  CreateTicketDto,
  ListTicketsFilters,
  TicketActor,
  TicketStatsSnapshot,
  UpdateTicketDto,
} from './tickets.types';

@Injectable()
export class TicketsService {
  // ── Reads ─────────────────────────────────────────────────────────────

  async list(companyId: string, filters: ListTicketsFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    const where: Prisma.TicketWhereInput = { companyId };

    if (filters.status) {
      where.status = Array.isArray(filters.status)
        ? { in: filters.status }
        : filters.status;
    }
    if (filters.priority) {
      where.priority = Array.isArray(filters.priority)
        ? { in: filters.priority }
        : filters.priority;
    }
    if (filters.source) {
      where.source = Array.isArray(filters.source)
        ? { in: filters.source }
        : filters.source;
    }
    if (filters.assignedToId !== undefined) {
      where.assignedToId = filters.assignedToId;
    }
    if (filters.contactId) where.contactId = filters.contactId;
    if (filters.category) where.category = filters.category;
    if (filters.tag) where.tags = { has: filters.tag };
    if (filters.slaBreached) {
      where.OR = [
        { slaFirstResponseBreached: true },
        { slaResolutionBreached: true },
      ];
    }
    if (filters.createdFrom || filters.createdTo) {
      where.createdAt = {};
      if (filters.createdFrom) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(filters.createdFrom);
      if (filters.createdTo) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(filters.createdTo);
    }
    if (filters.search) {
      const q = filters.search;
      where.OR = [
        ...(where.OR ?? []),
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { ticketNumber: { contains: q, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.TicketOrderByWithRelationInput =
      filters.sort === 'priority'
        ? { priority: 'asc' }
        : filters.sort === 'updated'
          ? { updatedAt: 'desc' }
          : filters.sort === 'oldest'
            ? { createdAt: 'asc' }
            : { createdAt: 'desc' };

    const [items, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: { select: { comments: true } },
        },
      }),
      prisma.ticket.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async get(companyId: string, id: string) {
    const record = await prisma.ticket.findFirst({
      where: { id, companyId },
      include: {
        comments: { orderBy: { createdAt: 'asc' } },
        activities: { orderBy: { createdAt: 'desc' }, take: 30 },
      },
    });
    if (!record) throw new NotFoundException('Ticket not found');
    // Lazy SLA breach check on read
    await this.checkAndFlagSlaBreach(record);
    return record;
  }

  async getTimeline(companyId: string, id: string, limit = 100) {
    await this.getRaw(companyId, id);
    return prisma.ticketActivity.findMany({
      where: { ticketId: id, companyId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, Math.max(1, limit)),
    });
  }

  async listComments(companyId: string, id: string) {
    await this.getRaw(companyId, id);
    return prisma.ticketComment.findMany({
      where: { ticketId: id },
      orderBy: { createdAt: 'asc' },
    });
  }

  async stats(companyId: string, days = 30): Promise<TicketStatsSnapshot> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const tickets = await prisma.ticket.findMany({
      where: { companyId, createdAt: { gte: since } },
      select: {
        status: true,
        priority: true,
        createdAt: true,
        firstResponseAt: true,
        resolvedAt: true,
        slaFirstResponseBreached: true,
        slaResolutionBreached: true,
      },
    });

    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    let openTickets = 0;
    let resolvedTickets = 0;
    let slaBreachCount = 0;
    const firstResponseTimes: number[] = [];
    const resolutionTimes: number[] = [];

    for (const t of tickets) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
      if (t.status === 'OPEN' || t.status === 'IN_PROGRESS' || t.status === 'WAITING' || t.status === 'ESCALATED') {
        openTickets++;
      }
      if (t.status === 'RESOLVED' || t.status === 'CLOSED') resolvedTickets++;
      if (t.slaFirstResponseBreached || t.slaResolutionBreached) slaBreachCount++;
      if (t.firstResponseAt) {
        firstResponseTimes.push(
          (t.firstResponseAt.getTime() - t.createdAt.getTime()) / 60000,
        );
      }
      if (t.resolvedAt) {
        resolutionTimes.push(
          (t.resolvedAt.getTime() - t.createdAt.getTime()) / 60000,
        );
      }
    }

    const avg = (arr: number[]): number | null =>
      arr.length > 0 ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;

    return {
      rangeDays: days,
      totalTickets: tickets.length,
      byStatus,
      byPriority,
      openTickets,
      resolvedTickets,
      avgFirstResponseMins: avg(firstResponseTimes),
      avgResolutionMins: avg(resolutionTimes),
      slaBreachCount,
    };
  }

  // ── Writes ────────────────────────────────────────────────────────────

  async create(
    companyId: string,
    actor: TicketActor,
    dto: CreateTicketDto,
  ): Promise<Ticket> {
    if (!dto.title?.trim()) {
      throw new BadRequestException('title is required');
    }
    const ticketNumber = await this.uniqueTicketNumber(companyId);

    // SLA dates
    let slaPolicyId: string | undefined;
    let slaFirstResponseDue: Date | undefined;
    let slaResolutionDue: Date | undefined;
    if (dto.slaPolicyId) {
      const policy = await prisma.slaPolicy.findUnique({
        where: { id: dto.slaPolicyId },
      });
      if (policy && policy.isActive) {
        const now = new Date();
        const dates = computeSlaDue(now, {
          firstResponseMins: policy.firstResponseMins,
          resolutionMins: policy.resolutionMins,
        });
        slaPolicyId = policy.id;
        slaFirstResponseDue = dates.firstResponseDue;
        slaResolutionDue = dates.resolutionDue;
      }
    }

    const ticket = await prisma.ticket.create({
      data: {
        companyId,
        ticketNumber,
        title: dto.title.trim(),
        description: dto.description,
        contactId: dto.contactId,
        assignedToId: dto.assignedToId,
        priority: dto.priority ?? 'MEDIUM',
        category: dto.category,
        source: dto.source ?? 'WHATSAPP',
        tags: dto.tags ?? [],
        notes: dto.notes,
        createdByUserId: actor.type === 'user' ? actor.userId : null,
        slaPolicyId,
        slaFirstResponseDue,
        slaResolutionDue,
      },
      include: { comments: true },
    });
    await this.logActivity(companyId, ticket.id, actor, {
      type: 'CREATED',
      title: `Ticket ${ticket.ticketNumber} created`,
      metadata: { priority: ticket.priority, source: ticket.source, category: ticket.category },
    });
    return ticket;
  }

  async update(
    companyId: string,
    id: string,
    actor: TicketActor,
    dto: UpdateTicketDto,
  ): Promise<Ticket> {
    const existing = await this.getRaw(companyId, id);
    const data: Prisma.TicketUpdateInput = {};
    const diffs: Array<{ field: string; from: unknown; to: unknown }> = [];
    const assign = <K extends keyof UpdateTicketDto>(field: K) => {
      if (dto[field] === undefined) return;
      const newVal = dto[field];
      const oldVal = (existing as unknown as Record<string, unknown>)[field as string];
      if (newVal !== oldVal) {
        diffs.push({ field: field as string, from: oldVal, to: newVal });
        (data as Record<string, unknown>)[field as string] = newVal;
      }
    };
    assign('title');
    assign('description');
    assign('contactId');
    assign('priority');
    assign('category');
    assign('tags');
    assign('notes');

    if (dto.assignedToId !== undefined && dto.assignedToId !== existing.assignedToId) {
      diffs.push({ field: 'assignedToId', from: existing.assignedToId, to: dto.assignedToId });
      data.assignedToId = dto.assignedToId;
    }

    if (diffs.length === 0) return existing;

    const updated = await prisma.ticket.update({
      where: { id },
      data,
      include: { comments: true },
    });
    for (const d of diffs) {
      const actType: TicketActivityType =
        d.field === 'priority'
          ? 'PRIORITY_CHANGED'
          : d.field === 'assignedToId'
            ? dto.assignedToId
              ? 'ASSIGNED'
              : 'UNASSIGNED'
            : 'FIELD_UPDATED';
      await this.logActivity(companyId, id, actor, {
        type: actType,
        title: `${d.field} updated`,
        body: `${safeDisplay(d.from)} → ${safeDisplay(d.to)}`,
        metadata: { field: d.field, from: d.from, to: d.to },
      });
    }
    return updated;
  }

  async changeStatus(
    companyId: string,
    id: string,
    actor: TicketActor,
    newStatus: TicketStatus,
    reason?: string,
  ): Promise<Ticket> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status === newStatus) return existing;

    const now = new Date();
    const data: Prisma.TicketUpdateInput = { status: newStatus };
    let actType: TicketActivityType = 'STATUS_CHANGED';

    if (newStatus === 'RESOLVED') {
      data.resolvedAt = existing.resolvedAt ?? now;
      actType = 'RESOLVED';
    } else if (newStatus === 'CLOSED') {
      data.closedAt = existing.closedAt ?? now;
      actType = 'CLOSED';
    } else if (newStatus === 'ESCALATED') {
      data.escalatedAt = existing.escalatedAt ?? now;
      actType = 'ESCALATED';
    } else if (
      newStatus === 'OPEN' &&
      (existing.status === 'RESOLVED' || existing.status === 'CLOSED')
    ) {
      actType = 'REOPENED';
      data.resolvedAt = null;
      data.closedAt = null;
    }

    const updated = await prisma.ticket.update({
      where: { id },
      data,
      include: { comments: true },
    });
    await this.logActivity(companyId, id, actor, {
      type: actType,
      title: `Status → ${newStatus}`,
      body: reason,
      metadata: { from: existing.status, to: newStatus, reason },
    });
    return updated;
  }

  async assign(
    companyId: string,
    id: string,
    actor: TicketActor,
    assignedToId: string | null,
  ): Promise<Ticket> {
    const existing = await this.getRaw(companyId, id);
    if (existing.assignedToId === assignedToId) return existing;
    const updated = await prisma.ticket.update({
      where: { id },
      data: { assignedToId },
      include: { comments: true },
    });
    await this.logActivity(companyId, id, actor, {
      type: assignedToId ? 'ASSIGNED' : 'UNASSIGNED',
      title: assignedToId ? `Assigned to ${assignedToId}` : 'Unassigned',
      metadata: { from: existing.assignedToId, to: assignedToId },
    });
    // First response tracking: if no first response yet and actor is a user/ai
    if (
      !existing.firstResponseAt &&
      assignedToId &&
      (actor.type === 'user' || actor.type === 'ai')
    ) {
      await prisma.ticket.update({
        where: { id },
        data: { firstResponseAt: new Date() },
      });
      await this.logActivity(companyId, id, actor, {
        type: 'FIRST_RESPONSE',
        title: 'First response',
      });
    }
    return updated;
  }

  async escalate(
    companyId: string,
    id: string,
    actor: TicketActor,
    reason?: string,
  ): Promise<Ticket> {
    return this.changeStatus(companyId, id, actor, 'ESCALATED', reason);
  }

  async addComment(
    companyId: string,
    id: string,
    actor: TicketActor,
    content: string,
    isInternal = false,
  ): Promise<TicketComment> {
    const existing = await this.getRaw(companyId, id);
    if (!content?.trim()) {
      throw new BadRequestException('comment content required');
    }
    const comment = await prisma.ticketComment.create({
      data: {
        ticketId: id,
        companyId,
        authorId: actor.type === 'user' ? actor.userId : null,
        authorType: actor.type,
        content: content.trim(),
        isInternal,
      },
    });
    await this.logActivity(companyId, id, actor, {
      type: isInternal ? 'INTERNAL_NOTE_ADDED' : 'COMMENT_ADDED',
      title: isInternal ? 'Internal note' : 'Comment added',
      body: content.trim().slice(0, 300),
      metadata: { commentId: comment.id, isInternal },
    });
    // First response tracking
    if (
      !existing.firstResponseAt &&
      !isInternal &&
      (actor.type === 'user' || actor.type === 'ai')
    ) {
      await prisma.ticket.update({
        where: { id },
        data: { firstResponseAt: new Date() },
      });
      await this.logActivity(companyId, id, actor, {
        type: 'FIRST_RESPONSE',
        title: 'First response (via comment)',
      });
    }
    return comment;
  }

  async merge(
    companyId: string,
    sourceId: string,
    targetId: string,
    actor: TicketActor,
  ): Promise<Ticket> {
    const source = await this.getRaw(companyId, sourceId);
    await this.getRaw(companyId, targetId); // validate target exists

    // Move comments from source to target
    await prisma.ticketComment.updateMany({
      where: { ticketId: sourceId },
      data: { ticketId: targetId },
    });

    // Close source with a merged reference
    const updated = await prisma.ticket.update({
      where: { id: sourceId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        mergedIntoId: targetId,
      },
      include: { comments: true },
    });
    await this.logActivity(companyId, sourceId, actor, {
      type: 'MERGED',
      title: `Merged into ${targetId}`,
      metadata: { targetTicketId: targetId },
    });
    await this.logActivity(companyId, targetId, actor, {
      type: 'MERGED',
      title: `Received merge from ${source.ticketNumber}`,
      metadata: { sourceTicketId: sourceId },
    });
    return updated;
  }

  async addNote(
    companyId: string,
    id: string,
    actor: TicketActor,
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
    if (existing.status !== 'CLOSED') {
      throw new BadRequestException(
        `Only CLOSED tickets can be deleted (current: ${existing.status})`,
      );
    }
    await prisma.ticket.delete({ where: { id } });
  }

  // ── Bulk ops ──────────────────────────────────────────────────────────

  async bulkAssign(
    companyId: string,
    ids: string[],
    actor: TicketActor,
    assignedToId: string,
  ): Promise<BulkMutationResult> {
    return this.runBulk(ids, (id) =>
      this.assign(companyId, id, actor, assignedToId),
    );
  }

  async bulkClose(
    companyId: string,
    ids: string[],
    actor: TicketActor,
  ): Promise<BulkMutationResult> {
    return this.runBulk(ids, (id) =>
      this.changeStatus(companyId, id, actor, 'CLOSED'),
    );
  }

  async bulkDelete(
    companyId: string,
    ids: string[],
  ): Promise<BulkMutationResult> {
    return this.runBulk(ids, (id) => this.remove(companyId, id));
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async getRaw(companyId: string, id: string): Promise<Ticket> {
    const record = await prisma.ticket.findFirst({ where: { id, companyId } });
    if (!record) throw new NotFoundException('Ticket not found');
    return record;
  }

  private async uniqueTicketNumber(companyId: string): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const candidate = generateTicketNumber();
      const existing = await prisma.ticket.findUnique({
        where: { companyId_ticketNumber: { companyId, ticketNumber: candidate } },
      });
      if (!existing) return candidate;
    }
    return `TKT-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  }

  /** Lazily stamp breach flags when the ticket is read. */
  private async checkAndFlagSlaBreach(ticket: Ticket): Promise<void> {
    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') return;
    const now = new Date();
    const updates: Prisma.TicketUpdateInput = {};
    if (
      !ticket.slaFirstResponseBreached &&
      !ticket.firstResponseAt &&
      isBreached(ticket.slaFirstResponseDue, now)
    ) {
      updates.slaFirstResponseBreached = true;
    }
    if (
      !ticket.slaResolutionBreached &&
      !ticket.resolvedAt &&
      isBreached(ticket.slaResolutionDue, now)
    ) {
      updates.slaResolutionBreached = true;
    }
    if (Object.keys(updates).length > 0) {
      await prisma.ticket.update({ where: { id: ticket.id }, data: updates });
      if (updates.slaFirstResponseBreached) {
        await this.logActivity(ticket.companyId, ticket.id, { type: 'system' }, {
          type: 'SLA_BREACHED',
          title: 'SLA first-response breached',
        });
      }
      if (updates.slaResolutionBreached) {
        await this.logActivity(ticket.companyId, ticket.id, { type: 'system' }, {
          type: 'SLA_BREACHED',
          title: 'SLA resolution breached',
        });
      }
    }
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
    ticketId: string,
    actor: TicketActor,
    input: AddTicketActivityInput,
  ) {
    return prisma.ticketActivity.create({
      data: {
        ticketId,
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

function safeDisplay(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.join(', ') || '[]';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
