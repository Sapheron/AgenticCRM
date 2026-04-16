/**
 * DealsService — single write path for everything Deal-related.
 *
 * Mirrors `LeadsService`. Every mutation:
 *   1) Logs an entry to `DealActivity` (timeline)
 *   2) Recomputes `weightedValue = value * probability/100`
 *   3) Auto-applies stage default probability when stage moves and no
 *      probability was explicitly passed
 *
 * Callers (controller, AI tools, WhatsApp ingest, payment webhook) pass in
 * a `DealActor` so each activity row is correctly attributed.
 */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import type { Deal, DealStage, Prisma } from '@wacrm/database';
import {
  type CreateDealDto,
  type UpdateDealDto,
  type ListDealsFilters,
  type MoveStageInput,
  type CreateLineItemDto,
  type UpdateLineItemDto,
  type AddDealActivityInput,
  type DealActor,
} from './deals.types';
import { computeForecast, STAGE_DEFAULT_PROBABILITY, type DealForecast } from './forecast';

@Injectable()
export class DealsService {
  // ── Reads ────────────────────────────────────────────────────────────────

  async list(companyId: string, filters: ListDealsFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(200, filters.limit ?? 50);
    const where = this.buildWhere(companyId, filters);
    const orderBy = this.buildOrderBy(filters.sort);

    const [items, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        include: {
          contact: { select: { id: true, displayName: true, phoneNumber: true } },
          assignedAgent: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          lead: { select: { id: true, title: true } },
        },
      }),
      prisma.deal.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async get(companyId: string, id: string) {
    const deal = await prisma.deal.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        contact: true,
        assignedAgent: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        lead: { select: { id: true, title: true, status: true } },
        payments: { orderBy: { createdAt: 'desc' }, take: 20 },
        tasks: { orderBy: { createdAt: 'desc' }, take: 20 },
        lineItems: { orderBy: { position: 'asc' } },
        activities: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!deal) throw new NotFoundException('Deal not found');
    return deal;
  }

  async getTimeline(companyId: string, id: string, limit = 100) {
    await this.ensureExists(companyId, id);
    return prisma.dealActivity.findMany({
      where: { dealId: id, companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, limit),
    });
  }

  async getLineItems(companyId: string, id: string) {
    await this.ensureExists(companyId, id);
    return prisma.dealLineItem.findMany({
      where: { dealId: id, companyId },
      orderBy: { position: 'asc' },
    });
  }

  async forecast(companyId: string, days = 30): Promise<DealForecast> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const deals = await prisma.deal.findMany({
      where: { companyId, deletedAt: null, createdAt: { gte: since } },
      select: {
        id: true,
        title: true,
        stage: true,
        source: true,
        value: true,
        probability: true,
        wonAt: true,
        lostAt: true,
        lostReasonCode: true,
        salesCycleDays: true,
        createdAt: true,
      },
    });
    return computeForecast({ rangeDays: days, deals });
  }

  async lossReasonAnalytics(companyId: string, days = 90) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const grouped = await prisma.deal.groupBy({
      by: ['lostReasonCode'],
      where: { companyId, deletedAt: null, stage: 'LOST', lostAt: { gte: since } },
      _count: { _all: true },
      _sum: { value: true },
    });
    return grouped.map((g) => ({
      reason: g.lostReasonCode ?? 'OTHER',
      count: g._count._all,
      value: g._sum.value ?? 0,
    }));
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  async create(companyId: string, dto: CreateDealDto, actor: DealActor): Promise<Deal> {
    if (!dto.title?.trim()) throw new BadRequestException('Deal title is required');
    if (typeof dto.value !== 'number' || dto.value < 0) {
      throw new BadRequestException('Deal value must be a non-negative number');
    }

    const contactId = await this.resolveContactId(companyId, dto);
    if (!contactId) throw new BadRequestException('contactId or phoneNumber is required');

    const stage = dto.stage ?? 'LEAD_IN';
    const probability = dto.probability ?? STAGE_DEFAULT_PROBABILITY[stage];
    const value = dto.value;
    const weightedValue = value * (probability / 100);

    const deal = await prisma.deal.create({
      data: {
        companyId,
        contactId,
        leadId: dto.leadId,
        assignedAgentId: dto.assignedAgentId,
        title: dto.title,
        stage,
        source: dto.source ?? (actor.type === 'ai' ? 'AI_CHAT' : 'MANUAL'),
        priority: dto.priority ?? 'MEDIUM',
        value,
        currency: dto.currency ?? 'INR',
        probability,
        weightedValue,
        tags: dto.tags ?? [],
        notes: dto.notes,
        expectedCloseAt: dto.expectedCloseAt ? new Date(dto.expectedCloseAt) : null,
        nextActionAt: dto.nextActionAt ? new Date(dto.nextActionAt) : null,
        nextActionNote: dto.nextActionNote,
        customFields: (dto.customFields ?? {}) as Prisma.InputJsonValue,
      },
    });

    await this.logActivity(companyId, deal.id, actor, {
      type: 'CREATED',
      title: `Deal created: "${deal.title}"`,
      metadata: { value: deal.value, currency: deal.currency, source: deal.source },
    });

    return deal;
  }

  async update(companyId: string, id: string, dto: UpdateDealDto, actor: DealActor): Promise<Deal> {
    const existing = await this.get(companyId, id);
    const data: Prisma.DealUpdateInput = {};
    const changes: string[] = [];

    const set = <K extends keyof UpdateDealDto>(
      key: K,
      transform?: (v: UpdateDealDto[K]) => unknown,
    ) => {
      if (dto[key] === undefined) return;
      const next = transform ? transform(dto[key]) : dto[key];
      const prev = (existing as unknown as Record<string, unknown>)[key as string];
      if (next !== prev) {
        (data as Record<string, unknown>)[key as string] = next;
        changes.push(String(key));
      }
    };

    set('title');
    set('value');
    set('currency');
    set('source');
    set('priority');
    set('probability');
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

    // Stage changes go through `moveStage` to enforce closed-deal immutability
    // and probability defaults — block direct status updates here.
    if (dto.stage !== undefined && dto.stage !== existing.stage) {
      throw new BadRequestException('Use moveStage() to change deal stage');
    }

    if (changes.length === 0) return existing as Deal;

    // Recompute weightedValue if value or probability changed.
    if (changes.includes('value') || changes.includes('probability')) {
      const nextValue = (data.value as number) ?? existing.value;
      const nextProb = (data.probability as number) ?? existing.probability;
      data.weightedValue = nextValue * (nextProb / 100);
    }

    const updated = await prisma.deal.update({ where: { id }, data });
    await this.logActivity(companyId, id, actor, {
      type: changes.includes('probability') ? 'PROBABILITY_UPDATED'
          : changes.includes('value') ? 'VALUE_UPDATED'
          : 'FIELD_UPDATED',
      title: `Updated: ${changes.join(', ')}`,
      metadata: { fields: changes },
    });

    return updated;
  }

  async moveStage(
    companyId: string,
    id: string,
    input: MoveStageInput,
    actor: DealActor,
  ): Promise<Deal> {
    const existing = await this.get(companyId, id);
    const { stage } = input;

    if (existing.stage === stage) return existing as Deal;

    // Closed deals cannot be moved with this method — use `reopen()` first.
    if ((existing.stage === 'WON' || existing.stage === 'LOST') && actor.type !== 'payment') {
      throw new BadRequestException('Closed deal — call reopen() first');
    }

    const data: Prisma.DealUpdateInput = { stage };
    const now = new Date();

    // Auto-apply stage default probability ONLY if the user is still on the
    // previous stage's default — this preserves manual overrides.
    const prevDefault = STAGE_DEFAULT_PROBABILITY[existing.stage];
    if (existing.probability === prevDefault) {
      data.probability = STAGE_DEFAULT_PROBABILITY[stage];
      data.weightedValue = existing.value * (STAGE_DEFAULT_PROBABILITY[stage] / 100);
    }

    if (stage === 'QUALIFIED') data.qualifiedAt = now;
    if (stage === 'PROPOSAL') data.proposalSentAt = now;
    if (stage === 'WON') {
      data.wonAt = now;
      data.probability = 100;
      data.weightedValue = existing.value;
      data.salesCycleDays = Math.max(
        0,
        Math.round((now.getTime() - existing.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
      );
    }
    if (stage === 'LOST') {
      data.lostAt = now;
      data.probability = 0;
      data.weightedValue = 0;
      data.salesCycleDays = Math.max(
        0,
        Math.round((now.getTime() - existing.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
      );
      if (input.lossReason) data.lostReasonCode = input.lossReason;
      if (input.lossReasonText) data.lostReason = input.lossReasonText;
    }

    const updated = await prisma.deal.update({ where: { id }, data });

    await this.logActivity(companyId, id, actor, {
      type: stage === 'WON' ? 'WON' : stage === 'LOST' ? 'LOST' : 'STAGE_CHANGED',
      title: `Stage: ${existing.stage} → ${stage}`,
      body: input.lossReasonText,
      metadata: {
        fromStage: existing.stage,
        toStage: stage,
        lossReason: input.lossReason,
      },
    });

    return updated;
  }

  async assign(companyId: string, id: string, userId: string | null, actor: DealActor): Promise<Deal> {
    const existing = await this.get(companyId, id);
    if (existing.assignedAgentId === userId) return existing as Deal;

    if (userId) {
      const user = await prisma.user.findFirst({ where: { id: userId, companyId } });
      if (!user) throw new BadRequestException(`User ${userId} not found in this company`);
    }

    const updated = await prisma.deal.update({ where: { id }, data: { assignedAgentId: userId } });
    await this.logActivity(companyId, id, actor, {
      type: userId ? 'ASSIGNED' : 'UNASSIGNED',
      title: userId ? `Assigned to user ${userId}` : 'Unassigned',
      metadata: { previousAgentId: existing.assignedAgentId, newAgentId: userId },
    });
    return updated;
  }

  async addNote(companyId: string, id: string, body: string, actor: DealActor) {
    await this.ensureExists(companyId, id);
    const note = body.trim();
    if (!note) throw new BadRequestException('Note body is required');

    const existing = await prisma.deal.findUnique({ where: { id }, select: { notes: true } });
    const stamp = new Date().toISOString().slice(0, 10);
    const appended = `${existing?.notes ? existing.notes + '\n\n' : ''}[${stamp}] ${note}`;
    await prisma.deal.update({ where: { id }, data: { notes: appended } });

    return this.logActivity(companyId, id, actor, {
      type: 'NOTE_ADDED',
      title: note.slice(0, 80),
      body: note,
    });
  }

  async updateNote(
    companyId: string,
    dealId: string,
    activityId: string,
    newBody: string,
    actor: DealActor,
  ) {
    const note = (newBody ?? '').trim();
    if (!note) throw new BadRequestException('Note content is required');

    const activity = await prisma.dealActivity.findFirst({
      where: { id: activityId, dealId, companyId, deletedAt: null },
    });
    if (!activity) throw new NotFoundException('Note not found');
    if (activity.type !== 'NOTE_ADDED') {
      throw new BadRequestException('Only note-type activities can be edited');
    }
    if (actor.type === 'user' && activity.actorId && activity.actorId !== actor.userId) {
      throw new BadRequestException('You can only edit your own notes');
    }

    return prisma.dealActivity.update({
      where: { id: activityId },
      data: { title: note.slice(0, 80), body: note },
    });
  }

  async deleteNote(companyId: string, dealId: string, activityId: string, actor: DealActor) {
    const activity = await prisma.dealActivity.findFirst({
      where: { id: activityId, dealId, companyId, deletedAt: null },
    });
    if (!activity) throw new NotFoundException('Note not found');
    if (activity.type !== 'NOTE_ADDED') {
      throw new BadRequestException('Only note-type activities can be deleted');
    }
    if (actor.type === 'user' && activity.actorId && activity.actorId !== actor.userId) {
      throw new BadRequestException('You can only delete your own notes');
    }
    await prisma.dealActivity.update({
      where: { id: activityId },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  async addActivity(
    companyId: string,
    id: string,
    input: AddDealActivityInput,
    actor: DealActor,
  ) {
    await this.ensureExists(companyId, id);
    return this.logActivity(companyId, id, actor, input);
  }

  async setProbability(
    companyId: string,
    id: string,
    probability: number,
    reason: string,
    actor: DealActor,
  ): Promise<Deal> {
    const existing = await this.get(companyId, id);
    const clamped = Math.max(0, Math.min(100, probability));
    if (clamped === existing.probability) return existing as Deal;

    const weighted = existing.value * (clamped / 100);
    const updated = await prisma.deal.update({
      where: { id },
      data: { probability: clamped, weightedValue: weighted },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'PROBABILITY_UPDATED',
      title: `Probability ${existing.probability}% → ${clamped}%`,
      body: reason,
      metadata: { from: existing.probability, to: clamped },
    });
    return updated;
  }

  async reopen(companyId: string, id: string, reason: string, actor: DealActor): Promise<Deal> {
    const existing = await this.get(companyId, id);
    if (existing.stage !== 'WON' && existing.stage !== 'LOST') {
      throw new BadRequestException('Deal is not closed');
    }

    const updated = await prisma.deal.update({
      where: { id },
      data: {
        stage: 'NEGOTIATION',
        probability: STAGE_DEFAULT_PROBABILITY.NEGOTIATION,
        weightedValue: existing.value * (STAGE_DEFAULT_PROBABILITY.NEGOTIATION / 100),
        wonAt: null,
        lostAt: null,
        lostReasonCode: null,
        lostReason: null,
        salesCycleDays: null,
      },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'REOPENED',
      title: 'Deal reopened',
      body: reason,
      metadata: { previousStage: existing.stage },
    });
    return updated;
  }

  async remove(companyId: string, id: string, actor: DealActor) {
    await this.ensureExists(companyId, id);
    const deal = await prisma.deal.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'CUSTOM',
      title: 'Deal deleted',
    });
    return deal;
  }

  // ── Line items ──────────────────────────────────────────────────────────

  async addLineItem(companyId: string, id: string, dto: CreateLineItemDto, actor: DealActor) {
    await this.ensureExists(companyId, id);
    const total = computeLineItemTotal(dto);

    const item = await prisma.dealLineItem.create({
      data: {
        dealId: id,
        companyId,
        productId: dto.productId,
        name: dto.name,
        description: dto.description,
        quantity: dto.quantity ?? 1,
        unitPrice: dto.unitPrice,
        discount: dto.discount ?? 0,
        taxRate: dto.taxRate ?? 0,
        total,
        position: dto.position ?? 0,
      },
    });

    await this.logActivity(companyId, id, actor, {
      type: 'LINE_ITEM_ADDED',
      title: `Added line item: ${dto.name}`,
      metadata: { itemId: item.id, total },
    });

    return item;
  }

  async updateLineItem(
    companyId: string,
    dealId: string,
    itemId: string,
    dto: UpdateLineItemDto,
    actor: DealActor,
  ) {
    const existing = await prisma.dealLineItem.findFirst({
      where: { id: itemId, dealId, companyId },
    });
    if (!existing) throw new NotFoundException('Line item not found');

    const merged = {
      productId: dto.productId === undefined ? existing.productId : dto.productId,
      name: dto.name ?? existing.name,
      description: dto.description === undefined ? existing.description : dto.description,
      quantity: dto.quantity ?? existing.quantity,
      unitPrice: dto.unitPrice ?? existing.unitPrice,
      discount: dto.discount ?? existing.discount,
      taxRate: dto.taxRate ?? existing.taxRate,
      position: dto.position ?? existing.position,
    };
    const total = computeLineItemTotal(merged);

    const updated = await prisma.dealLineItem.update({
      where: { id: itemId },
      data: { ...merged, total },
    });
    await this.logActivity(companyId, dealId, actor, {
      type: 'FIELD_UPDATED',
      title: `Updated line item: ${updated.name}`,
      metadata: { itemId, total },
    });
    return updated;
  }

  async removeLineItem(companyId: string, dealId: string, itemId: string, actor: DealActor) {
    const existing = await prisma.dealLineItem.findFirst({
      where: { id: itemId, dealId, companyId },
    });
    if (!existing) throw new NotFoundException('Line item not found');
    await prisma.dealLineItem.delete({ where: { id: itemId } });
    await this.logActivity(companyId, dealId, actor, {
      type: 'LINE_ITEM_REMOVED',
      title: `Removed line item: ${existing.name}`,
      metadata: { itemId },
    });
    return { ok: true };
  }

  // ── Bulk ────────────────────────────────────────────────────────────────

  async bulkMoveStage(
    companyId: string,
    ids: string[],
    stage: DealStage,
    actor: DealActor,
    lossReason?: import('@wacrm/database').DealLossReason,
  ) {
    let updated = 0;
    for (const id of ids) {
      try {
        await this.moveStage(companyId, id, { stage, lossReason }, actor);
        updated++;
      } catch { /* skip */ }
    }
    return { requested: ids.length, updated };
  }

  async bulkAssign(companyId: string, ids: string[], userId: string | null, actor: DealActor) {
    let updated = 0;
    for (const id of ids) {
      try { await this.assign(companyId, id, userId, actor); updated++; } catch { /* skip */ }
    }
    return { requested: ids.length, updated };
  }

  async bulkDelete(companyId: string, ids: string[], actor: DealActor) {
    let deleted = 0;
    for (const id of ids) {
      try { await this.remove(companyId, id, actor); deleted++; } catch { /* skip */ }
    }
    return { requested: ids.length, deleted };
  }

  async bulkTag(
    companyId: string,
    ids: string[],
    add: string[] = [],
    remove: string[] = [],
    actor: DealActor,
  ) {
    let updated = 0;
    for (const id of ids) {
      try {
        const deal = await prisma.deal.findFirst({
          where: { id, companyId, deletedAt: null },
          select: { tags: true },
        });
        if (!deal) continue;
        const next = Array.from(new Set([...deal.tags.filter((t) => !remove.includes(t)), ...add]));
        await prisma.deal.update({ where: { id }, data: { tags: next } });
        await this.logActivity(companyId, id, actor, {
          type: add.length ? 'TAG_ADDED' : 'TAG_REMOVED',
          title: `Tags: ${add.length ? '+' + add.join(',') : ''}${remove.length ? ' -' + remove.join(',') : ''}`,
          metadata: { add, remove },
        });
        updated++;
      } catch { /* skip */ }
    }
    return { requested: ids.length, updated };
  }

  // ── Payment webhook ─────────────────────────────────────────────────────

  /**
   * Called by the payment webhook when a payment succeeds.
   * Public signature unchanged from the previous version, so existing callers
   * keep working — but now logs activities for the timeline.
   */
  async markWonByPayment(dealId: string, paymentId?: string) {
    const deal = await prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal) return null;

    await this.logActivity(deal.companyId, dealId, { type: 'payment' }, {
      type: 'PAYMENT_RECEIVED',
      title: 'Payment received',
      metadata: { paymentId },
    });

    if (deal.stage === 'WON') return deal;

    return this.moveStage(
      deal.companyId,
      dealId,
      { stage: 'WON' },
      { type: 'payment' },
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async ensureExists(companyId: string, id: string) {
    const found = await prisma.deal.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Deal not found');
  }

  private async resolveContactId(companyId: string, dto: CreateDealDto): Promise<string | null> {
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

  private buildWhere(companyId: string, f: ListDealsFilters): Prisma.DealWhereInput {
    const where: Prisma.DealWhereInput = { companyId, deletedAt: null };
    if (f.stage) where.stage = Array.isArray(f.stage) ? { in: f.stage } : f.stage;
    if (f.source) where.source = Array.isArray(f.source) ? { in: f.source } : f.source;
    if (f.priority) where.priority = Array.isArray(f.priority) ? { in: f.priority } : f.priority;
    if (f.assignedAgentId === null) where.assignedAgentId = null;
    else if (f.assignedAgentId) where.assignedAgentId = f.assignedAgentId;
    if (f.contactId) where.contactId = f.contactId;
    if (f.leadId) where.leadId = f.leadId;
    if (f.tag) where.tags = { has: f.tag };
    if (f.valueMin !== undefined || f.valueMax !== undefined) {
      where.value = {};
      if (f.valueMin !== undefined) where.value.gte = f.valueMin;
      if (f.valueMax !== undefined) where.value.lte = f.valueMax;
    }
    if (f.probabilityMin !== undefined || f.probabilityMax !== undefined) {
      where.probability = {};
      if (f.probabilityMin !== undefined) where.probability.gte = f.probabilityMin;
      if (f.probabilityMax !== undefined) where.probability.lte = f.probabilityMax;
    }
    if (f.expectedCloseFrom || f.expectedCloseTo) {
      where.expectedCloseAt = {};
      if (f.expectedCloseFrom) where.expectedCloseAt.gte = new Date(f.expectedCloseFrom);
      if (f.expectedCloseTo) where.expectedCloseAt.lte = new Date(f.expectedCloseTo);
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

  private buildOrderBy(sort?: ListDealsFilters['sort']): Prisma.DealOrderByWithRelationInput {
    switch (sort) {
      case 'value': return { value: 'desc' };
      case 'probability': return { probability: 'desc' };
      case 'next_action': return { nextActionAt: 'asc' };
      case 'expected_close': return { expectedCloseAt: 'asc' };
      case 'created': return { createdAt: 'desc' };
      case 'recent':
      default: return { updatedAt: 'desc' };
    }
  }

  private async logActivity(
    companyId: string,
    dealId: string,
    actor: DealActor,
    input: AddDealActivityInput,
  ) {
    return prisma.dealActivity.create({
      data: {
        dealId,
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

function computeLineItemTotal(item: {
  quantity?: number;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
}): number {
  const qty = item.quantity ?? 1;
  const subtotal = qty * item.unitPrice;
  const discounted = subtotal * (1 - (item.discount ?? 0) / 100);
  const withTax = discounted * (1 + (item.taxRate ?? 0) / 100);
  return Math.round(withTax * 100) / 100;
}
