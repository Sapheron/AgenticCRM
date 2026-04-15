/**
 * TemplatesService — single write path for template management.
 *
 * Mirrors the entity upgrade pattern. Every mutation logs a `TemplateActivity`
 * row for timeline tracking. Supports full lifecycle: DRAFT → ACTIVE → ARCHIVED,
 * with usage tracking, A/B testing variants, and conversion metrics.
 */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import type { Template, Prisma } from '@wacrm/database';
import {
  type TemplateActor,
  type CreateTemplateDto,
  type UpdateTemplateDto,
  type ListTemplatesFilters,
  type AddTemplateActivityInput,
} from './templates.types';
import { extractVariables, renderTemplate } from './template-utils';

@Injectable()
export class TemplatesService {
  // ── Reads ────────────────────────────────────────────────────────────────

  async list(companyId: string, filters: ListTemplatesFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, filters.limit ?? 50);
    const where = this.buildWhere(companyId, filters);
    const orderBy = this.buildOrderBy(filters.sort);

    const [items, total] = await Promise.all([
      prisma.template.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
      }),
      prisma.template.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async get(companyId: string, id: string) {
    const template = await prisma.template.findFirst({
      where: { id, companyId },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        activities: { orderBy: { createdAt: 'desc' }, take: 50 },
        variants: { orderBy: { createdAt: 'asc' } },
        parent: { select: { id: true, name: true } },
      },
    });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  async getTimeline(companyId: string, id: string, limit = 100) {
    await this.ensureExists(companyId, id);
    return prisma.templateActivity.findMany({
      where: { templateId: id, companyId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, limit),
    });
  }

  async stats(companyId: string, _days = 30) {
    const [total, byStatus, byCategory, byType, topTemplates] = await Promise.all([
      prisma.template.count({ where: { companyId } }),
      prisma.template.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { _all: true },
      }),
      prisma.template.groupBy({
        by: ['category'],
        where: { companyId },
        _count: { _all: true },
      }),
      prisma.template.groupBy({
        by: ['type'],
        where: { companyId },
        _count: { _all: true },
      }),
      prisma.template.findMany({
        where: { companyId, status: 'ACTIVE' },
        orderBy: { useCount: 'desc' },
        take: 10,
        select: { id: true, name: true, category: true, useCount: true, conversionCount: true },
      }),
    ]);

    const statusCounts = Object.fromEntries(byStatus.map((g) => [g.status, g._count._all]));
    const categoryCounts = Object.fromEntries(byCategory.map((g) => [g.category, g._count._all]));
    const typeCounts = Object.fromEntries(byType.map((g) => [g.type, g._count._all]));

    const totalUses = await prisma.template.aggregate({
      where: { companyId },
      _sum: { useCount: true },
    });

    return {
      totalTemplates: total,
      activeTemplates: statusCounts['ACTIVE'] ?? 0,
      draftTemplates: statusCounts['DRAFT'] ?? 0,
      archivedTemplates: statusCounts['ARCHIVED'] ?? 0,
      totalUses: (totalUses._sum.useCount ?? 0) as number,
      topTemplates: topTemplates.map((t) => ({
        ...t,
        conversionRate: t.useCount > 0 ? Math.round((t.conversionCount / t.useCount) * 100) : 0,
      })),
      byCategory: categoryCounts,
      byType: typeCounts,
    };
  }

  getCategories() {
    // Return all available categories
    return [
      'GREETING',
      'FOLLOW_UP',
      'PROMOTION',
      'PAYMENT_REMINDER',
      'ORDER_UPDATE',
      'SUPPORT',
      'FEEDBACK',
      'REVIEW',
      'APPOINTMENT',
      'GENERAL',
    ];
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  async create(companyId: string, dto: CreateTemplateDto, actor: TemplateActor): Promise<Template> {
    if (!dto.name?.trim()) throw new BadRequestException('Template name is required');
    if (!dto.body?.trim()) throw new BadRequestException('Template body is required');

    const createdById = actor.type === 'user' ? actor.userId : null;
    const variables = dto.variables ?? {};

    const template = await prisma.template.create({
      data: {
        companyId,
        name: dto.name.trim(),
        type: dto.type ?? 'TEXT',
        category: ((dto.category ?? 'GENERAL').toUpperCase()) as never,
        body: dto.body,
        mediaUrl: dto.mediaUrl,
        language: dto.language ?? 'en',
        tags: dto.tags ?? [],
        variables: variables as Prisma.InputJsonValue,
        status: 'DRAFT',
        createdById,
      },
    });

    await this.logActivity(companyId, template.id, actor, {
      type: 'CREATED',
      title: `Template created: "${template.name}"`,
      metadata: { category: template.category, type: template.type },
    });

    return template;
  }

  async update(companyId: string, id: string, dto: UpdateTemplateDto, actor: TemplateActor): Promise<Template> {
    const existing = await this.get(companyId, id);
    if (existing.status !== 'DRAFT' && existing.status !== 'ARCHIVED') {
      throw new BadRequestException(`Cannot edit a ${existing.status} template`);
    }

    const data: Prisma.TemplateUpdateInput = {};
    const changes: string[] = [];

    const set = <K extends keyof UpdateTemplateDto>(key: K) => {
      if (dto[key] === undefined) return;
      const next = dto[key];
      const prev = (existing as unknown as Record<string, unknown>)[key as string];
      if (next !== prev) {
        (data as Record<string, unknown>)[key as string] = next;
        changes.push(String(key));
      }
    };

    set('name');
    set('type');
    set('category');
    set('body');
    set('mediaUrl');
    set('language');
    set('tags');
    if (dto.variables !== undefined) {
      data.variables = dto.variables as Prisma.InputJsonValue;
      changes.push('variables');
    }
    set('status');

    if (changes.length === 0) return existing as Template;

    const updated = await prisma.template.update({ where: { id }, data });

    await this.logActivity(companyId, id, actor, {
      type: 'UPDATED',
      title: `Updated: ${changes.join(', ')}`,
      metadata: { fields: changes },
    });

    return updated;
  }

  async activate(companyId: string, id: string, actor: TemplateActor): Promise<Template> {
    const existing = await this.get(companyId, id);
    if (existing.status === 'ACTIVE') {
      return existing as Template;
    }
    if (existing.status === 'ARCHIVED') {
      throw new BadRequestException('Cannot activate an archived template');
    }

    // Auto-extract variables from body
    const variables = extractVariables(existing.body);

    const updated = await prisma.template.update({
      where: { id },
      data: { status: 'ACTIVE', variables: variables as Prisma.InputJsonValue },
    });

    await this.logActivity(companyId, id, actor, {
      type: 'ACTIVATED',
      title: 'Template activated',
      metadata: { variables },
    });

    return updated;
  }

  async archive(companyId: string, id: string, actor: TemplateActor): Promise<Template> {
    const existing = await this.get(companyId, id);
    if (existing.status === 'ARCHIVED') {
      return existing as Template;
    }

    const updated = await prisma.template.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });

    await this.logActivity(companyId, id, actor, {
      type: 'ARCHIVED',
      title: 'Template archived',
    });

    return updated;
  }

  async duplicate(companyId: string, id: string, actor: TemplateActor, newName?: string): Promise<Template> {
    const source = await this.get(companyId, id);
    return this.create(
      companyId,
      {
        name: newName ?? `${source.name} (copy)`,
        type: source.type as never,
        category: source.category as never,
        body: source.body,
        mediaUrl: source.mediaUrl ?? undefined,
        language: source.language,
        tags: source.tags,
        variables: (source.variables ?? {}) as Record<string, string>,
      },
      actor,
    );
  }

  async delete(companyId: string, id: string, actor: TemplateActor) {
    const existing = await this.get(companyId, id);
    if (existing.status === 'ACTIVE') {
      throw new BadRequestException('Cannot delete an active template. Archive it first.');
    }

    await this.logActivity(companyId, id, actor, {
      type: 'DELETED',
      title: `Deleted template "${existing.name}"`,
    });

    return prisma.template.delete({ where: { id } });
  }

  // ── Template Operations ─────────────────────────────────────────────────────

  async render(companyId: string, id: string, variables: Record<string, string>) {
    const template = await this.get(companyId, id);
    const defaults = (template.variables ?? {}) as Record<string, string>;

    const rendered = renderTemplate(template.body, variables, defaults);

    await this.logActivity(companyId, id, { type: 'system' }, {
      type: 'PREVIEWED',
      title: 'Template previewed',
    });

    return { templateId: id, rendered, variables: { ...defaults, ...variables } };
  }

  async recordUsage(companyId: string, templateId: string, metadata?: Record<string, unknown>) {
    const template = await prisma.template.findFirst({ where: { id: templateId, companyId } });
    if (!template) return;

    await Promise.all([
      prisma.template.update({
        where: { id: templateId },
        data: {
          useCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
      }),
      this.logActivity(companyId, templateId, { type: 'system' }, {
        type: 'USED',
        title: 'Template used',
        metadata,
      }),
    ]);
  }

  async recordSent(companyId: string, templateId: string) {
    await Promise.all([
      prisma.template.update({
        where: { id: templateId },
        data: { sentCount: { increment: 1 } },
      }),
      this.logActivity(companyId, templateId, { type: 'system' }, {
        type: 'SENT',
        title: 'Template sent via WhatsApp',
      }),
    ]);
  }

  async recordConversion(companyId: string, templateId: string) {
    await prisma.template.update({
      where: { id: templateId },
      data: { conversionCount: { increment: 1 } },
    });
    await this.logActivity(companyId, templateId, { type: 'system' }, {
      type: 'CONVERTED',
      title: 'Template led to conversion',
    });
  }

  async addActivity(companyId: string, id: string, input: AddTemplateActivityInput, actor: TemplateActor) {
    return this.logActivity(companyId, id, actor, input);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async ensureExists(companyId: string, id: string) {
    const found = await prisma.template.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Template not found');
  }

  private buildWhere(companyId: string, f: ListTemplatesFilters): Prisma.TemplateWhereInput {
    const where: Prisma.TemplateWhereInput = { companyId };
    if (f.status) where.status = Array.isArray(f.status) ? { in: f.status } : f.status;
    if (f.category) where.category = f.category;
    if (f.type) where.type = f.type;
    if (f.tags && f.tags.length > 0) {
      where.tags = { hasSome: f.tags };
    }
    if (f.search?.trim()) {
      const q = f.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { body: { contains: q, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private buildOrderBy(sort?: ListTemplatesFilters['sort']): Prisma.TemplateOrderByWithRelationInput {
    switch (sort) {
      case 'recent':
      default:
        return { createdAt: 'desc' };
      case 'used':
        return { useCount: 'desc' };
      case 'name':
        return { name: 'asc' };
      case 'converting':
        return { conversionCount: 'desc' };
    }
  }

  private async logActivity(
    companyId: string,
    templateId: string,
    actor: TemplateActor,
    input: AddTemplateActivityInput,
  ) {
    return prisma.templateActivity.create({
      data: {
        templateId,
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
