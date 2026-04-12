/**
 * Knowledge Base service — single write path for every article mutation.
 *
 * KB articles are a content entity (not transactional) so the shape is
 * simpler than Quotes/Invoices: no line items, no FSM transitions beyond
 * DRAFT → PUBLISHED → ARCHIVED, no payments. The main unique feature is
 * a public reader with slug-based URLs and view-count tracking.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma } from '@wacrm/database';
import type {
  KnowledgeBaseArticle,
  Prisma,
} from '@wacrm/database';

import type {
  AddKBArticleActivityInput,
  BulkMutationResult,
  CreateKBArticleDto,
  KBArticleActor,
  KBArticleStatsSnapshot,
  ListKBArticlesFilters,
  PublicKBArticleDefinition,
  PublicKBListItem,
  UpdateKBArticleDto,
} from './knowledge-base.types';

@Injectable()
export class KnowledgeBaseService {
  // ── Reads ─────────────────────────────────────────────────────────────

  async list(companyId: string, filters: ListKBArticlesFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    const where: Prisma.KnowledgeBaseArticleWhereInput = { companyId };

    if (filters.status) {
      where.status = Array.isArray(filters.status)
        ? { in: filters.status }
        : filters.status;
    }
    if (filters.category) where.category = filters.category;
    if (filters.isPublic !== undefined) where.isPublic = filters.isPublic;
    if (filters.tag) where.tags = { has: filters.tag };
    if (filters.search) {
      const q = filters.search;
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { content: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { category: { contains: q, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.KnowledgeBaseArticleOrderByWithRelationInput =
      filters.sort === 'views'
        ? { viewCount: 'desc' }
        : filters.sort === 'title'
          ? { title: 'asc' }
          : { createdAt: 'desc' };

    const [items, total] = await Promise.all([
      prisma.knowledgeBaseArticle.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.knowledgeBaseArticle.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async get(companyId: string, id: string) {
    const record = await prisma.knowledgeBaseArticle.findFirst({
      where: { id, companyId },
      include: {
        activities: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!record) throw new NotFoundException('Article not found');
    return record;
  }

  async getTimeline(companyId: string, id: string, limit = 100) {
    await this.getRaw(companyId, id);
    return prisma.kBArticleActivity.findMany({
      where: { articleId: id, companyId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, Math.max(1, limit)),
    });
  }

  async stats(companyId: string, days = 30): Promise<KBArticleStatsSnapshot> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const articles = await prisma.knowledgeBaseArticle.findMany({
      where: { companyId, createdAt: { gte: since } },
      select: { status: true, viewCount: true, category: true },
    });

    const byStatus: Record<string, number> = {};
    let totalViews = 0;
    const catCounts: Record<string, number> = {};

    for (const a of articles) {
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
      totalViews += a.viewCount;
      if (a.category) {
        catCounts[a.category] = (catCounts[a.category] ?? 0) + 1;
      }
    }

    const topCategories = Object.entries(catCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));

    return {
      rangeDays: days,
      totalArticles: articles.length,
      byStatus,
      publishedArticles: byStatus['PUBLISHED'] ?? 0,
      totalViews,
      topCategories,
    };
  }

  async search(
    companyId: string,
    query: string,
    limit = 10,
  ): Promise<KnowledgeBaseArticle[]> {
    if (!query?.trim()) return [];
    return prisma.knowledgeBaseArticle.findMany({
      where: {
        companyId,
        status: 'PUBLISHED',
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { content: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { category: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: { viewCount: 'desc' },
      take: Math.min(50, Math.max(1, limit)),
    });
  }

  /** Public list — published + isPublic articles only, scrubbed. */
  async listPublic(limit = 50): Promise<PublicKBListItem[]> {
    const articles = await prisma.knowledgeBaseArticle.findMany({
      where: { status: 'PUBLISHED', isPublic: true },
      select: { slug: true, title: true, description: true, category: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(200, limit),
    });
    return articles;
  }

  /** Public article — slug lookup, only if PUBLISHED + isPublic. */
  async getPublicBySlug(slug: string): Promise<PublicKBArticleDefinition | null> {
    const record = await prisma.knowledgeBaseArticle.findFirst({
      where: { slug, status: 'PUBLISHED', isPublic: true },
    });
    if (!record) return null;
    const company = await prisma.company.findUnique({
      where: { id: record.companyId },
      select: { name: true },
    });
    return {
      id: record.id,
      slug: record.slug,
      title: record.title,
      description: record.description,
      content: record.content,
      category: record.category,
      viewCount: record.viewCount,
      updatedAt: record.updatedAt,
      company: { name: company?.name ?? 'Unknown' },
    };
  }

  async incrementViewCount(slug: string): Promise<void> {
    await prisma.knowledgeBaseArticle.updateMany({
      where: { slug, status: 'PUBLISHED', isPublic: true },
      data: { viewCount: { increment: 1 } },
    });
  }

  // ── Writes ────────────────────────────────────────────────────────────

  async create(
    companyId: string,
    actor: KBArticleActor,
    dto: CreateKBArticleDto,
  ): Promise<KnowledgeBaseArticle> {
    if (!dto.title?.trim()) throw new BadRequestException('title required');
    if (!dto.content?.trim()) throw new BadRequestException('content required');

    const slug = await this.uniqueSlug(companyId, dto.title);

    const article = await prisma.knowledgeBaseArticle.create({
      data: {
        companyId,
        slug,
        title: dto.title.trim(),
        description: dto.description,
        content: dto.content,
        category: dto.category,
        isPublic: dto.isPublic ?? true,
        tags: dto.tags ?? [],
        notes: dto.notes,
        createdByUserId: actor.type === 'user' ? actor.userId : null,
      },
    });
    await this.logActivity(companyId, article.id, actor, {
      type: 'CREATED',
      title: `Article "${article.title}" created`,
      metadata: { slug, category: dto.category },
    });
    return article;
  }

  async update(
    companyId: string,
    id: string,
    actor: KBArticleActor,
    dto: UpdateKBArticleDto,
  ): Promise<KnowledgeBaseArticle> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status === 'ARCHIVED') {
      throw new BadRequestException('Restore the article before editing');
    }

    const data: Prisma.KnowledgeBaseArticleUpdateInput = {};
    const diffs: Array<{ field: string; from: unknown; to: unknown }> = [];
    const assign = <K extends keyof UpdateKBArticleDto>(field: K) => {
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
    assign('category');
    assign('isPublic');
    assign('tags');
    assign('notes');

    const contentChanged = dto.content !== undefined && dto.content !== existing.content;
    if (contentChanged) {
      diffs.push({ field: 'content', from: '(prev)', to: '(updated)' });
      data.content = dto.content!;
    }

    if (diffs.length === 0) return existing;

    const updated = await prisma.knowledgeBaseArticle.update({ where: { id }, data });
    for (const d of diffs) {
      await this.logActivity(companyId, id, actor, {
        type: d.field === 'content' ? 'CONTENT_UPDATED' : 'FIELD_UPDATED',
        title: `${d.field} updated`,
        body: d.field !== 'content' ? `${safeDisplay(d.from)} → ${safeDisplay(d.to)}` : undefined,
        metadata: { field: d.field },
      });
    }
    return updated;
  }

  async publish(
    companyId: string,
    id: string,
    actor: KBArticleActor,
  ): Promise<KnowledgeBaseArticle> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(
        `Only DRAFT articles can be published (current: ${existing.status})`,
      );
    }
    const updated = await prisma.knowledgeBaseArticle.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: existing.publishedAt ?? new Date() },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'PUBLISHED',
      title: 'Article published',
    });
    return updated;
  }

  async unpublish(
    companyId: string,
    id: string,
    actor: KBArticleActor,
  ): Promise<KnowledgeBaseArticle> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status !== 'PUBLISHED') {
      throw new BadRequestException(
        `Only PUBLISHED articles can be unpublished (current: ${existing.status})`,
      );
    }
    const updated = await prisma.knowledgeBaseArticle.update({
      where: { id },
      data: { status: 'DRAFT' },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'UNPUBLISHED',
      title: 'Article unpublished',
    });
    return updated;
  }

  async archive(
    companyId: string,
    id: string,
    actor: KBArticleActor,
  ): Promise<KnowledgeBaseArticle> {
    const existing = await this.getRaw(companyId, id);
    const updated = await prisma.knowledgeBaseArticle.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'ARCHIVED',
      title: 'Article archived',
      metadata: { prevStatus: existing.status },
    });
    return updated;
  }

  async restore(
    companyId: string,
    id: string,
    actor: KBArticleActor,
  ): Promise<KnowledgeBaseArticle> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status !== 'ARCHIVED') {
      throw new BadRequestException(`Only ARCHIVED articles can be restored`);
    }
    const updated = await prisma.knowledgeBaseArticle.update({
      where: { id },
      data: { status: 'DRAFT' },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'RESTORED',
      title: 'Article restored',
    });
    return updated;
  }

  async duplicate(
    companyId: string,
    id: string,
    actor: KBArticleActor,
  ): Promise<KnowledgeBaseArticle> {
    const src = await this.getRaw(companyId, id);
    const slug = await this.uniqueSlug(companyId, `${src.title} copy`);
    const dup = await prisma.knowledgeBaseArticle.create({
      data: {
        companyId,
        slug,
        title: `${src.title} (copy)`,
        description: src.description,
        content: src.content,
        category: src.category,
        isPublic: false,
        tags: src.tags,
        createdByUserId: actor.type === 'user' ? actor.userId : null,
      },
    });
    await this.logActivity(companyId, dup.id, actor, {
      type: 'DUPLICATED',
      title: `Duplicated from "${src.title}"`,
      metadata: { sourceArticleId: src.id },
    });
    return dup;
  }

  async addNote(
    companyId: string,
    id: string,
    actor: KBArticleActor,
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
    if (existing.status === 'PUBLISHED') {
      throw new BadRequestException('Unpublish or archive the article before deleting');
    }
    await prisma.knowledgeBaseArticle.delete({ where: { id } });
  }

  // ── Bulk ops ──────────────────────────────────────────────────────────

  async bulkPublish(companyId: string, ids: string[], actor: KBArticleActor): Promise<BulkMutationResult> {
    return this.runBulk(ids, (id) => this.publish(companyId, id, actor));
  }

  async bulkArchive(companyId: string, ids: string[], actor: KBArticleActor): Promise<BulkMutationResult> {
    return this.runBulk(ids, (id) => this.archive(companyId, id, actor));
  }

  async bulkDelete(companyId: string, ids: string[]): Promise<BulkMutationResult> {
    return this.runBulk(ids, (id) => this.remove(companyId, id));
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async getRaw(companyId: string, id: string): Promise<KnowledgeBaseArticle> {
    const record = await prisma.knowledgeBaseArticle.findFirst({ where: { id, companyId } });
    if (!record) throw new NotFoundException('Article not found');
    return record;
  }

  private async uniqueSlug(companyId: string, title: string): Promise<string> {
    let base = title
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
    if (!base) base = 'article';
    let candidate = base;
    let i = 1;
    while (
      await prisma.knowledgeBaseArticle.findUnique({
        where: { companyId_slug: { companyId, slug: candidate } },
      })
    ) {
      i++;
      candidate = `${base}-${i}`;
      if (i > 100) {
        candidate = `${base}-${Date.now().toString(36).slice(-4)}`;
        break;
      }
    }
    return candidate;
  }

  private async runBulk(ids: string[], op: (id: string) => Promise<unknown>): Promise<BulkMutationResult> {
    let updated = 0;
    let failed = 0;
    const errors: Array<{ id: string; reason: string }> = [];
    for (const id of ids) {
      try { await op(id); updated++; } catch (err) {
        failed++;
        errors.push({ id, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    return { updated, failed, errors };
  }

  private async logActivity(
    companyId: string,
    articleId: string,
    actor: KBArticleActor,
    input: AddKBArticleActivityInput,
  ) {
    return prisma.kBArticleActivity.create({
      data: {
        articleId,
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
