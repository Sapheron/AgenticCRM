/**
 * LeadsService — the single write path for everything Lead-related.
 *
 * Every mutation goes through here so that:
 *   1) `LeadActivity` rows are written for the timeline
 *   2) `LeadScoreEvent` rows are written for the score audit trail
 *   3) The score is recalculated whenever a status / tag / message event
 *      could move it
 *
 * Callers (controller, AI tools, WhatsApp ingest hooks) pass in a `LeadActor`
 * so each activity row is correctly attributed.
 */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import type {
  Lead,
  LeadStatus,
  Prisma,
} from '@wacrm/database';
import {
  type CreateLeadDto,
  type UpdateLeadDto,
  type ListLeadsFilters,
  type ConvertLeadDto,
  type LeadActor,
  type AddActivityInput,
} from './leads.types';
import { applyScoringRules, type ScoreSnapshot } from './scoring';

const DUP_WINDOW_DAYS = 30;
const DUP_WINDOW_MS = DUP_WINDOW_DAYS * 24 * 60 * 60 * 1000;

@Injectable()
export class LeadsService {
  // ── Reads ────────────────────────────────────────────────────────────────

  async list(companyId: string, filters: ListLeadsFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, filters.limit ?? 50);
    const where = this.buildWhere(companyId, filters);

    const orderBy = this.buildOrderBy(filters.sort);

    const [items, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        include: {
          contact: { select: { id: true, displayName: true, phoneNumber: true } },
          assignedAgent: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          deals: { select: { id: true, title: true, stage: true, value: true } },
        },
      }),
      prisma.lead.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async get(companyId: string, id: string) {
    const lead = await prisma.lead.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        contact: true,
        assignedAgent: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        deals: true,
        activities: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async getTimeline(companyId: string, id: string, limit = 100) {
    await this.ensureExists(companyId, id);
    return prisma.leadActivity.findMany({
      where: { leadId: id, companyId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, limit),
    });
  }

  async getScoreHistory(companyId: string, id: string) {
    await this.ensureExists(companyId, id);
    return prisma.leadScoreEvent.findMany({
      where: { leadId: id, companyId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async stats(companyId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const where = { companyId, deletedAt: null, createdAt: { gte: since } };

    const grouped = await prisma.lead.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      _sum: { estimatedValue: true },
      _avg: { score: true },
    });

    const total = grouped.reduce((acc, g) => acc + g._count._all, 0);
    const won = grouped.find((g) => g.status === 'WON');
    const wonCount = won?._count._all ?? 0;
    const wonValue = won?._sum.estimatedValue ?? 0;

    const sourceBreakdown = await prisma.lead.groupBy({
      by: ['source'],
      where,
      _count: { _all: true },
    });

    return {
      rangeDays: days,
      total,
      byStatus: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
      avgScore: grouped.length
        ? Math.round(grouped.reduce((a, g) => a + (g._avg.score ?? 0), 0) / grouped.length)
        : 0,
      wonCount,
      wonValue,
      conversionRate: total > 0 ? Math.round((wonCount / total) * 100) : 0,
      bySource: Object.fromEntries(sourceBreakdown.map((s) => [s.source, s._count._all])),
    };
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  async create(companyId: string, dto: CreateLeadDto, actor: LeadActor): Promise<Lead> {
    if (!dto.title?.trim()) throw new BadRequestException('Lead title is required');

    // Resolve contact: by id, by phone (upsert), or fail.
    const contactId = await this.resolveContactId(companyId, dto);
    if (!contactId) {
      throw new BadRequestException('contactId or phoneNumber is required');
    }

    // Duplicate detection — refuse if an open lead exists for this contact in
    // the last 30 days, unless force is set.
    if (!dto.force) {
      const dup = await prisma.lead.findFirst({
        where: {
          companyId,
          contactId,
          deletedAt: null,
          status: { notIn: ['WON', 'LOST', 'DISQUALIFIED'] },
          createdAt: { gte: new Date(Date.now() - DUP_WINDOW_MS) },
        },
        select: { id: true, title: true, status: true },
      });
      if (dup) {
        throw new BadRequestException(
          `Open lead already exists for this contact (id=${dup.id}, "${dup.title}", status=${dup.status}). Pass force=true to create anyway.`,
        );
      }
    }

    const lead = await prisma.lead.create({
      data: {
        companyId,
        contactId,
        title: dto.title,
        status: dto.status ?? 'NEW',
        source: dto.source ?? (actor.type === 'ai' ? 'AI_CHAT' : 'MANUAL'),
        priority: dto.priority ?? 'MEDIUM',
        score: dto.score ?? 0,
        probability: dto.probability ?? 20,
        estimatedValue: dto.estimatedValue,
        currency: dto.currency ?? 'INR',
        tags: dto.tags ?? [],
        notes: dto.notes,
        expectedCloseAt: dto.expectedCloseAt ? new Date(dto.expectedCloseAt) : null,
        nextActionAt: dto.nextActionAt ? new Date(dto.nextActionAt) : null,
        nextActionNote: dto.nextActionNote,
        customFields: (dto.customFields ?? {}) as Prisma.InputJsonValue,
        assignedAgentId: dto.assignedAgentId,
      },
    });

    await this.logActivity(companyId, lead.id, actor, {
      type: 'CREATED',
      title: `Lead created: "${lead.title}"`,
      metadata: { source: lead.source, priority: lead.priority },
    });

    // Initial score pass.
    await this.recalculateScore(companyId, lead.id).catch(() => undefined);

    return lead;
  }

  async update(companyId: string, id: string, dto: UpdateLeadDto, actor: LeadActor): Promise<Lead> {
    const existing = await this.get(companyId, id);
    const data: Prisma.LeadUpdateInput = {};

    // Track which fields actually changed for the activity log.
    const changes: string[] = [];
    const set = <K extends keyof UpdateLeadDto>(key: K, transform?: (v: UpdateLeadDto[K]) => unknown) => {
      if (dto[key] === undefined) return;
      const next = transform ? transform(dto[key]) : dto[key];
      const prev = (existing as unknown as Record<string, unknown>)[key as string];
      if (next !== prev) {
        (data as Record<string, unknown>)[key as string] = next;
        changes.push(String(key));
      }
    };

    set('title');
    set('status');
    set('source');
    set('priority');
    set('probability');
    set('estimatedValue');
    set('currency');
    set('tags', (v) => v ?? []);
    set('notes');
    set('expectedCloseAt', (v) => (v == null ? null : new Date(v as string | Date)));
    set('nextActionAt', (v) => (v == null ? null : new Date(v as string | Date)));
    set('nextActionNote');
    set('assignedAgentId');
    if (dto.customFields !== undefined) {
      data.customFields = dto.customFields as Prisma.InputJsonValue;
      changes.push('customFields');
    }

    if (changes.length === 0) return existing as Lead;

    const updated = await prisma.lead.update({ where: { id }, data });
    await this.logActivity(companyId, id, actor, {
      type: 'FIELD_UPDATED',
      title: `Updated: ${changes.join(', ')}`,
      metadata: { fields: changes },
    });

    // Recalc if anything score-relevant changed.
    if (changes.some((c) => ['status', 'tags', 'estimatedValue'].includes(c))) {
      await this.recalculateScore(companyId, id).catch(() => undefined);
    }

    return updated;
  }

  async updateStatus(
    companyId: string,
    id: string,
    status: LeadStatus,
    actor: LeadActor,
    reason?: string,
  ): Promise<Lead> {
    const existing = await this.get(companyId, id);
    if (existing.status === status) return existing as Lead;

    const data: Prisma.LeadUpdateInput = { status };
    const now = new Date();
    if (status === 'WON') data.wonAt = now;
    if (status === 'LOST') {
      data.lostAt = now;
      if (reason) data.lostReason = reason;
    }
    if (status === 'QUALIFIED') data.qualifiedAt = now;
    if (status === 'DISQUALIFIED') {
      data.disqualifiedAt = now;
      if (reason) data.disqualifiedReason = reason;
    }

    const updated = await prisma.lead.update({ where: { id }, data });

    await this.logActivity(companyId, id, actor, {
      type:
        status === 'WON' ? 'WON'
        : status === 'LOST' ? 'LOST'
        : status === 'DISQUALIFIED' ? 'DISQUALIFIED'
        : 'STATUS_CHANGED',
      title: `Status: ${existing.status} → ${status}`,
      body: reason,
      metadata: { fromStatus: existing.status, toStatus: status, reason },
    });

    await this.recalculateScore(companyId, id).catch(() => undefined);
    return updated;
  }

  async assign(companyId: string, id: string, userId: string | null, actor: LeadActor): Promise<Lead> {
    const existing = await this.get(companyId, id);
    if (existing.assignedAgentId === userId) return existing as Lead;

    if (userId) {
      const user = await prisma.user.findFirst({ where: { id: userId, companyId } });
      if (!user) throw new BadRequestException(`User ${userId} not found in this company`);
    }

    const updated = await prisma.lead.update({
      where: { id },
      data: { assignedAgentId: userId },
    });

    await this.logActivity(companyId, id, actor, {
      type: userId ? 'ASSIGNED' : 'UNASSIGNED',
      title: userId ? `Assigned to user ${userId}` : 'Unassigned',
      metadata: { previousAgentId: existing.assignedAgentId, newAgentId: userId },
    });

    return updated;
  }

  async addNote(companyId: string, id: string, body: string, actor: LeadActor) {
    await this.ensureExists(companyId, id);
    const note = body.trim();
    if (!note) throw new BadRequestException('Note body is required');

    // Append to legacy `Lead.notes` for backwards compat.
    const existing = await prisma.lead.findUnique({ where: { id }, select: { notes: true } });
    const stamp = new Date().toISOString().slice(0, 10);
    const appended = `${existing?.notes ? existing.notes + '\n\n' : ''}[${stamp}] ${note}`;
    await prisma.lead.update({ where: { id }, data: { notes: appended } });

    return this.logActivity(companyId, id, actor, {
      type: 'NOTE_ADDED',
      title: note.slice(0, 80),
      body: note,
    });
  }

  async addActivity(companyId: string, id: string, input: AddActivityInput, actor: LeadActor) {
    await this.ensureExists(companyId, id);
    return this.logActivity(companyId, id, actor, input);
  }

  async setScore(
    companyId: string,
    id: string,
    delta: number,
    reason: string,
    source: 'auto' | 'manual' | 'ai' | string,
    actor: LeadActor,
  ) {
    const existing = await this.get(companyId, id);
    const newScore = Math.max(0, Math.min(100, existing.score + delta));
    const actualDelta = newScore - existing.score;

    if (actualDelta === 0) return existing as Lead;

    const updated = await prisma.lead.update({
      where: { id },
      data: { score: newScore },
    });
    await prisma.leadScoreEvent.create({
      data: { leadId: id, companyId, delta: actualDelta, newScore, reason, source },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'SCORED',
      title: `Score ${actualDelta > 0 ? '+' : ''}${actualDelta} → ${newScore}`,
      body: reason,
      metadata: { delta: actualDelta, newScore, source },
    });

    return updated;
  }

  async recalculateScore(companyId: string, id: string): Promise<Lead> {
    const lead = await prisma.lead.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    // Pull recent messages on the contact's WhatsApp conversations.
    const recentMessages = await prisma.message.findMany({
      where: {
        companyId,
        conversation: { contactId: lead.contactId },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, direction: true, createdAt: true },
    });

    const snapshot: ScoreSnapshot = {
      lead,
      recentMessages,
      previousScore: lead.score,
    };

    const { hits, newScore } = applyScoringRules(snapshot);
    if (newScore === lead.score) return lead;

    const updated = await prisma.lead.update({
      where: { id },
      data: { score: newScore },
    });

    // Record one event with the cumulative delta + a list of fired rules.
    await prisma.leadScoreEvent.create({
      data: {
        leadId: id,
        companyId,
        delta: newScore - lead.score,
        newScore,
        reason: hits.length
          ? hits.map((h) => `${h.rule}: ${h.delta > 0 ? '+' : ''}${h.delta}`).join(', ')
          : 'recalculate',
        source: 'auto',
      },
    });

    return updated;
  }

  async convertToDeal(
    companyId: string,
    id: string,
    dto: ConvertLeadDto,
    actor: LeadActor,
  ): Promise<{ lead: Lead; dealId: string }> {
    const lead = await this.get(companyId, id);

    const deal = await prisma.deal.create({
      data: {
        companyId,
        contactId: lead.contactId,
        leadId: id,
        assignedAgentId: lead.assignedAgentId,
        title: dto.dealTitle ?? lead.title,
        stage: dto.stage ?? 'QUALIFIED',
        value: dto.value ?? lead.estimatedValue ?? 0,
        currency: dto.currency ?? lead.currency,
        probability: dto.probability ?? lead.probability,
        expectedCloseAt: dto.expectedCloseAt ? new Date(dto.expectedCloseAt) : lead.expectedCloseAt,
      },
    });

    const updated = await this.updateStatus(companyId, id, 'WON', actor, `Converted to deal ${deal.id}`);
    await this.logActivity(companyId, id, actor, {
      type: 'CONVERTED',
      title: `Converted to deal "${deal.title}"`,
      metadata: { dealId: deal.id, dealValue: deal.value },
    });

    return { lead: updated, dealId: deal.id };
  }

  async findDuplicates(companyId: string, contactId: string) {
    return prisma.lead.findMany({
      where: { companyId, contactId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, status: true, score: true, createdAt: true },
    });
  }

  async remove(companyId: string, id: string, actor: LeadActor) {
    await this.ensureExists(companyId, id);
    const lead = await prisma.lead.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'CUSTOM',
      title: 'Lead deleted',
    });
    return lead;
  }

  // ── Bulk ────────────────────────────────────────────────────────────────

  async bulkUpdateStatus(
    companyId: string,
    ids: string[],
    status: LeadStatus,
    actor: LeadActor,
    reason?: string,
  ) {
    let updated = 0;
    for (const id of ids) {
      try {
        await this.updateStatus(companyId, id, status, actor, reason);
        updated++;
      } catch {
        /* skip */
      }
    }
    return { requested: ids.length, updated };
  }

  async bulkAssign(companyId: string, ids: string[], userId: string | null, actor: LeadActor) {
    let updated = 0;
    for (const id of ids) {
      try {
        await this.assign(companyId, id, userId, actor);
        updated++;
      } catch {
        /* skip */
      }
    }
    return { requested: ids.length, updated };
  }

  async bulkDelete(companyId: string, ids: string[], actor: LeadActor) {
    let deleted = 0;
    for (const id of ids) {
      try {
        await this.remove(companyId, id, actor);
        deleted++;
      } catch {
        /* skip */
      }
    }
    return { requested: ids.length, deleted };
  }

  async bulkTag(
    companyId: string,
    ids: string[],
    add: string[] = [],
    remove: string[] = [],
    actor: LeadActor,
  ) {
    let updated = 0;
    for (const id of ids) {
      try {
        const lead = await prisma.lead.findFirst({
          where: { id, companyId, deletedAt: null },
          select: { tags: true },
        });
        if (!lead) continue;
        const next = Array.from(
          new Set([...lead.tags.filter((t) => !remove.includes(t)), ...add]),
        );
        await prisma.lead.update({ where: { id }, data: { tags: next } });
        await this.logActivity(companyId, id, actor, {
          type: add.length ? 'TAG_ADDED' : 'TAG_REMOVED',
          title: `Tags: ${add.length ? '+' + add.join(',') : ''}${remove.length ? ' -' + remove.join(',') : ''}`,
          metadata: { add, remove },
        });
        updated++;
      } catch {
        /* skip */
      }
    }
    return { requested: ids.length, updated };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async ensureExists(companyId: string, id: string) {
    const found = await prisma.lead.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Lead not found');
  }

  private async resolveContactId(companyId: string, dto: CreateLeadDto): Promise<string | null> {
    if (dto.contactId) return dto.contactId;
    if (!dto.phoneNumber) return null;
    const phone = normalizePhone(dto.phoneNumber);
    const contact = await prisma.contact.upsert({
      where: { companyId_phoneNumber: { companyId, phoneNumber: phone } },
      create: {
        companyId,
        phoneNumber: phone,
        displayName: dto.contactName ?? phone,
      },
      update: { deletedAt: null },
    });
    return contact.id;
  }

  private buildWhere(companyId: string, f: ListLeadsFilters): Prisma.LeadWhereInput {
    const where: Prisma.LeadWhereInput = { companyId, deletedAt: null };
    if (f.status) where.status = Array.isArray(f.status) ? { in: f.status } : f.status;
    if (f.source) where.source = Array.isArray(f.source) ? { in: f.source } : f.source;
    if (f.priority) where.priority = Array.isArray(f.priority) ? { in: f.priority } : f.priority;
    if (f.assignedAgentId === null) where.assignedAgentId = null;
    else if (f.assignedAgentId) where.assignedAgentId = f.assignedAgentId;
    if (f.contactId) where.contactId = f.contactId;
    if (f.tag) where.tags = { has: f.tag };
    if (f.scoreMin !== undefined || f.scoreMax !== undefined) {
      where.score = {};
      if (f.scoreMin !== undefined) where.score.gte = f.scoreMin;
      if (f.scoreMax !== undefined) where.score.lte = f.scoreMax;
    }
    if (f.valueMin !== undefined || f.valueMax !== undefined) {
      where.estimatedValue = {};
      if (f.valueMin !== undefined) where.estimatedValue.gte = f.valueMin;
      if (f.valueMax !== undefined) where.estimatedValue.lte = f.valueMax;
    }
    if (f.createdFrom || f.createdTo) {
      where.createdAt = {};
      if (f.createdFrom) where.createdAt.gte = new Date(f.createdFrom);
      if (f.createdTo) where.createdAt.lte = new Date(f.createdTo);
    }
    if (f.nextActionDue) where.nextActionAt = { lte: new Date() };

    if (f.search?.trim()) {
      const q = f.search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { notes: { contains: q, mode: 'insensitive' } },
        { contact: { displayName: { contains: q, mode: 'insensitive' } } },
        { contact: { phoneNumber: { contains: q } } },
      ];
    }
    return where;
  }

  private buildOrderBy(sort?: ListLeadsFilters['sort']): Prisma.LeadOrderByWithRelationInput {
    switch (sort) {
      case 'score': return { score: 'desc' };
      case 'value': return { estimatedValue: 'desc' };
      case 'next_action': return { nextActionAt: 'asc' };
      case 'created': return { createdAt: 'desc' };
      case 'recent':
      default: return { updatedAt: 'desc' };
    }
  }

  private async logActivity(
    companyId: string,
    leadId: string,
    actor: LeadActor,
    input: AddActivityInput,
  ) {
    return prisma.leadActivity.create({
      data: {
        leadId,
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

function normalizePhone(input: string): string {
  let p = input.replace(/[\s\-+()]/g, '');
  if (p.startsWith('0')) p = '91' + p.slice(1);
  if (p.length === 10 && /^\d+$/.test(p)) p = '91' + p;
  return p;
}
