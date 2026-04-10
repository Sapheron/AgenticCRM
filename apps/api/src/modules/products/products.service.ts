/**
 * ProductsService — single write path for everything Product-related.
 *
 * Mirrors `LeadsService` / `DealsService` / `TasksService`. Every mutation:
 *   1) Logs an entry to `ProductActivity` (the timeline)
 *   2) Auto-attributes the action via a `ProductActor` (user/ai/system)
 *   3) For inventory mutations, fires `STOCK_LOW` / `STOCK_OUT` activity
 *      rows when the level crosses thresholds, so the dashboard can show
 *      a stock-warning badge without polling
 *
 * Variants are stored as a JSON array on the product row (no separate
 * model). Each variant has its own `id`, optional `sku`, and can override
 * `price` and `stock` per-variant. Stock adjustments can target a specific
 * variant via `variantId`, otherwise they go against the parent product.
 */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import type { Prisma, Product } from '@wacrm/database';
import { randomUUID } from 'crypto';
import {
  type CreateProductDto,
  type UpdateProductDto,
  type ListProductsFilters,
  type AdjustStockDto,
  type SetStockDto,
  type ProductActor,
  type ProductVariant,
  type AddProductActivityInput,
} from './products.types';

@Injectable()
export class ProductsService {
  // ── Reads ────────────────────────────────────────────────────────────────

  async list(companyId: string, filters: ListProductsFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(200, filters.limit ?? 50);
    const where = this.buildWhere(companyId, filters);
    const orderBy = this.buildOrderBy(filters.sort);

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
      }),
      prisma.product.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async get(companyId: string, id: string) {
    const product = await prisma.product.findFirst({
      where: { id, companyId },
      include: {
        activities: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async getTimeline(companyId: string, id: string, limit = 100) {
    await this.ensureExists(companyId, id);
    return prisma.productActivity.findMany({
      where: { productId: id, companyId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, limit),
    });
  }

  async stats(companyId: string) {
    const [total, active, archived, lowStock, outOfStock, byCategory, totalValue] = await Promise.all([
      prisma.product.count({ where: { companyId, archivedAt: null } }),
      prisma.product.count({ where: { companyId, archivedAt: null, isActive: true } }),
      prisma.product.count({ where: { companyId, archivedAt: { not: null } } }),
      prisma.product.count({
        where: {
          companyId,
          archivedAt: null,
          trackInventory: true,
          stock: { gt: 0, lte: 10 }, // approximate; precise threshold check is per-product
        },
      }),
      prisma.product.count({
        where: { companyId, archivedAt: null, trackInventory: true, stock: { lte: 0 } },
      }),
      prisma.product.groupBy({
        by: ['category'],
        where: { companyId, archivedAt: null },
        _count: { _all: true },
      }),
      prisma.product.aggregate({
        where: { companyId, archivedAt: null, isActive: true },
        _sum: { price: true },
      }),
    ]);

    return {
      total,
      active,
      archived,
      lowStock,
      outOfStock,
      byCategory: Object.fromEntries(byCategory.map((g) => [g.category ?? 'uncategorized', g._count._all])),
      catalogValue: totalValue._sum.price ?? 0,
    };
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  async create(companyId: string, dto: CreateProductDto, actor: ProductActor): Promise<Product> {
    if (!dto.name?.trim()) throw new BadRequestException('Product name is required');

    // Ensure each incoming variant has an id
    const variants = (dto.variants ?? []).map((v) => ({ ...v, id: v.id ?? randomUUID() }));

    const product = await prisma.product.create({
      data: {
        companyId,
        name: dto.name,
        description: dto.description,
        price: dto.price ?? 0,
        costPrice: dto.costPrice,
        currency: dto.currency ?? 'INR',
        sku: dto.sku,
        barcode: dto.barcode,
        category: dto.category,
        tags: dto.tags ?? [],
        trackInventory: dto.trackInventory ?? false,
        stock: dto.stock ?? 0,
        reorderLevel: dto.reorderLevel ?? 0,
        images: dto.images ?? [],
        variants: variants as unknown as Prisma.InputJsonValue,
        isActive: dto.isActive ?? true,
      },
    });

    await this.logActivity(companyId, product.id, actor, {
      type: 'CREATED',
      title: `Product created: "${product.name}"`,
      metadata: { sku: product.sku, price: product.price, currency: product.currency },
    });

    return product;
  }

  async update(companyId: string, id: string, dto: UpdateProductDto, actor: ProductActor): Promise<Product> {
    const existing = await this.get(companyId, id);
    const data: Prisma.ProductUpdateInput = {};
    const changes: string[] = [];

    const set = <K extends keyof UpdateProductDto>(
      key: K,
      transform?: (v: UpdateProductDto[K]) => unknown,
    ) => {
      if (dto[key] === undefined) return;
      const next = transform ? transform(dto[key]) : dto[key];
      const prev = (existing as unknown as Record<string, unknown>)[key as string];
      if (next !== prev) {
        (data as Record<string, unknown>)[key as string] = next;
        changes.push(String(key));
      }
    };

    set('name');
    set('description');
    set('price');
    set('costPrice');
    set('currency');
    set('sku');
    set('barcode');
    set('category');
    set('tags', (v) => v ?? []);
    set('trackInventory');
    set('reorderLevel');
    set('images', (v) => v ?? []);
    set('isActive');
    if (dto.variants !== undefined) {
      const variants = dto.variants.map((v) => ({ ...v, id: v.id ?? randomUUID() }));
      data.variants = variants as unknown as Prisma.InputJsonValue;
      changes.push('variants');
    }

    if (changes.length === 0) return existing as Product;

    const updated = await prisma.product.update({ where: { id }, data });

    // Special-case the most important changes for the timeline
    if (changes.includes('price')) {
      await this.logActivity(companyId, id, actor, {
        type: 'PRICE_CHANGED',
        title: `Price ${existing.price} → ${updated.price} ${updated.currency}`,
        metadata: { from: existing.price, to: updated.price },
      });
    } else if (changes.includes('costPrice')) {
      await this.logActivity(companyId, id, actor, {
        type: 'COST_CHANGED',
        title: `Cost updated`,
        metadata: { from: existing.costPrice, to: updated.costPrice },
      });
    } else if (changes.includes('isActive')) {
      await this.logActivity(companyId, id, actor, {
        type: updated.isActive ? 'ACTIVATED' : 'ARCHIVED',
        title: updated.isActive ? 'Activated' : 'Deactivated',
      });
    } else {
      await this.logActivity(companyId, id, actor, {
        type: 'UPDATED',
        title: `Updated: ${changes.join(', ')}`,
        metadata: { fields: changes },
      });
    }

    return updated;
  }

  async addActivity(companyId: string, id: string, input: AddProductActivityInput, actor: ProductActor) {
    await this.ensureExists(companyId, id);
    return this.logActivity(companyId, id, actor, input);
  }

  // ── Inventory ────────────────────────────────────────────────────────────

  async adjustStock(
    companyId: string,
    id: string,
    dto: AdjustStockDto,
    actor: ProductActor,
  ): Promise<Product> {
    const existing = await this.get(companyId, id);
    if (!existing.trackInventory) {
      throw new BadRequestException('Inventory tracking is not enabled for this product');
    }

    if (dto.variantId) {
      return this.adjustVariantStock(companyId, existing, dto.variantId, dto.delta, dto.reason, actor);
    }

    const newStock = existing.stock + dto.delta;
    const updated = await prisma.product.update({
      where: { id },
      data: { stock: newStock },
    });

    await this.logActivity(companyId, id, actor, {
      type: dto.delta > 0 ? 'STOCK_RESTOCKED' : 'STOCK_ADJUSTED',
      title: `Stock ${dto.delta > 0 ? '+' : ''}${dto.delta} → ${newStock}`,
      body: dto.reason,
      metadata: { delta: dto.delta, from: existing.stock, to: newStock, reason: dto.reason },
    });

    await this.maybeWarnLowStock(companyId, updated, existing.stock, actor);
    return updated;
  }

  async setStock(
    companyId: string,
    id: string,
    dto: SetStockDto,
    actor: ProductActor,
  ): Promise<Product> {
    const existing = await this.get(companyId, id);
    if (!existing.trackInventory) {
      throw new BadRequestException('Inventory tracking is not enabled for this product');
    }

    if (dto.variantId) {
      const delta = dto.stock - this.findVariantStock(existing.variants, dto.variantId, existing.stock);
      return this.adjustVariantStock(companyId, existing, dto.variantId, delta, dto.reason, actor);
    }

    const updated = await prisma.product.update({
      where: { id },
      data: { stock: dto.stock },
    });

    await this.logActivity(companyId, id, actor, {
      type: 'STOCK_ADJUSTED',
      title: `Stock set to ${dto.stock}`,
      body: dto.reason,
      metadata: { from: existing.stock, to: dto.stock, reason: dto.reason },
    });

    await this.maybeWarnLowStock(companyId, updated, existing.stock, actor);
    return updated;
  }

  // ── Tags / archive ───────────────────────────────────────────────────────

  async addTag(companyId: string, id: string, tag: string, actor: ProductActor): Promise<Product> {
    const existing = await this.get(companyId, id);
    if (existing.tags.includes(tag)) return existing as Product;
    const next = [...existing.tags, tag];
    const updated = await prisma.product.update({ where: { id }, data: { tags: next } });
    await this.logActivity(companyId, id, actor, {
      type: 'TAG_ADDED',
      title: `Tag added: ${tag}`,
      metadata: { tag },
    });
    return updated;
  }

  async removeTag(companyId: string, id: string, tag: string, actor: ProductActor): Promise<Product> {
    const existing = await this.get(companyId, id);
    if (!existing.tags.includes(tag)) return existing as Product;
    const next = existing.tags.filter((t) => t !== tag);
    const updated = await prisma.product.update({ where: { id }, data: { tags: next } });
    await this.logActivity(companyId, id, actor, {
      type: 'TAG_REMOVED',
      title: `Tag removed: ${tag}`,
      metadata: { tag },
    });
    return updated;
  }

  async archive(companyId: string, id: string, actor: ProductActor): Promise<Product> {
    const existing = await this.get(companyId, id);
    if (existing.archivedAt) return existing as Product;
    const updated = await prisma.product.update({
      where: { id },
      data: { archivedAt: new Date(), isActive: false },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'ARCHIVED',
      title: 'Product archived',
    });
    return updated;
  }

  async unarchive(companyId: string, id: string, actor: ProductActor): Promise<Product> {
    const existing = await this.get(companyId, id);
    if (!existing.archivedAt) return existing as Product;
    const updated = await prisma.product.update({
      where: { id },
      data: { archivedAt: null, isActive: true },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'ACTIVATED',
      title: 'Product unarchived',
    });
    return updated;
  }

  async delete(companyId: string, id: string, actor: ProductActor) {
    const existing = await this.get(companyId, id);
    // Hard delete is risky if line items reference this product. Soft-archive
    // unless the caller is sure (we'll surface a forceDelete option in a tool later).
    const linkedDeals = await prisma.dealLineItem.count({ where: { productId: id } });
    if (linkedDeals > 0) {
      // Soft-archive instead
      return this.archive(companyId, id, actor);
    }
    await this.logActivity(companyId, id, actor, {
      type: 'DELETED',
      title: `Deleted "${existing.name}"`,
    });
    return prisma.product.delete({ where: { id } });
  }

  // ── Variants ────────────────────────────────────────────────────────────

  async addVariant(
    companyId: string,
    id: string,
    variant: Omit<ProductVariant, 'id'>,
    actor: ProductActor,
  ): Promise<Product> {
    const existing = await this.get(companyId, id);
    const next: ProductVariant[] = [
      ...this.parseVariants(existing.variants),
      { ...variant, id: randomUUID() },
    ];
    const updated = await prisma.product.update({
      where: { id },
      data: { variants: next as unknown as Prisma.InputJsonValue },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'VARIANT_ADDED',
      title: `Variant added: ${variant.name}`,
      metadata: { variant },
    });
    return updated;
  }

  async updateVariant(
    companyId: string,
    id: string,
    variantId: string,
    patch: Partial<ProductVariant>,
    actor: ProductActor,
  ): Promise<Product> {
    const existing = await this.get(companyId, id);
    const variants = this.parseVariants(existing.variants);
    const idx = variants.findIndex((v) => v.id === variantId);
    if (idx < 0) throw new NotFoundException('Variant not found');
    variants[idx] = { ...variants[idx], ...patch, id: variantId };
    const updated = await prisma.product.update({
      where: { id },
      data: { variants: variants as unknown as Prisma.InputJsonValue },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'VARIANT_UPDATED',
      title: `Variant updated: ${variants[idx].name}`,
      metadata: { variantId, patch },
    });
    return updated;
  }

  async removeVariant(
    companyId: string,
    id: string,
    variantId: string,
    actor: ProductActor,
  ): Promise<Product> {
    const existing = await this.get(companyId, id);
    const variants = this.parseVariants(existing.variants);
    const removed = variants.find((v) => v.id === variantId);
    if (!removed) throw new NotFoundException('Variant not found');
    const next = variants.filter((v) => v.id !== variantId);
    const updated = await prisma.product.update({
      where: { id },
      data: { variants: next as unknown as Prisma.InputJsonValue },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'VARIANT_REMOVED',
      title: `Variant removed: ${removed.name}`,
      metadata: { variantId },
    });
    return updated;
  }

  // ── Bulk ────────────────────────────────────────────────────────────────

  async bulkArchive(companyId: string, ids: string[], actor: ProductActor) {
    let updated = 0;
    for (const id of ids) {
      try { await this.archive(companyId, id, actor); updated++; } catch { /* skip */ }
    }
    return { requested: ids.length, updated };
  }

  async bulkUnarchive(companyId: string, ids: string[], actor: ProductActor) {
    let updated = 0;
    for (const id of ids) {
      try { await this.unarchive(companyId, id, actor); updated++; } catch { /* skip */ }
    }
    return { requested: ids.length, updated };
  }

  async bulkDelete(companyId: string, ids: string[], actor: ProductActor) {
    let deleted = 0;
    for (const id of ids) {
      try { await this.delete(companyId, id, actor); deleted++; } catch { /* skip */ }
    }
    return { requested: ids.length, deleted };
  }

  async bulkSetCategory(companyId: string, ids: string[], category: string | null, actor: ProductActor) {
    let updated = 0;
    for (const id of ids) {
      try {
        await this.update(companyId, id, { category }, actor);
        updated++;
      } catch { /* skip */ }
    }
    return { requested: ids.length, updated };
  }

  // ── Worker / cron helpers ───────────────────────────────────────────────

  async findLowStockProducts(companyId?: string) {
    return prisma.product.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        archivedAt: null,
        trackInventory: true,
        // Postgres can't compare two columns in Prisma's where without raw —
        // we filter in memory below.
      },
      select: {
        id: true,
        companyId: true,
        name: true,
        stock: true,
        reorderLevel: true,
      },
    }).then((rows) =>
      rows.filter((r) => r.reorderLevel > 0 && r.stock <= r.reorderLevel),
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private parseVariants(value: unknown): ProductVariant[] {
    if (Array.isArray(value)) return value as ProductVariant[];
    return [];
  }

  private findVariantStock(value: unknown, variantId: string, fallback: number): number {
    const variants = this.parseVariants(value);
    return variants.find((v) => v.id === variantId)?.stock ?? fallback;
  }

  private async adjustVariantStock(
    companyId: string,
    existing: Product,
    variantId: string,
    delta: number,
    reason: string | undefined,
    actor: ProductActor,
  ): Promise<Product> {
    const variants = this.parseVariants(existing.variants);
    const idx = variants.findIndex((v) => v.id === variantId);
    if (idx < 0) throw new NotFoundException('Variant not found');
    const current = variants[idx].stock ?? 0;
    const next = current + delta;
    variants[idx] = { ...variants[idx], stock: next };

    const updated = await prisma.product.update({
      where: { id: existing.id },
      data: { variants: variants as unknown as Prisma.InputJsonValue },
    });
    await this.logActivity(companyId, existing.id, actor, {
      type: delta > 0 ? 'STOCK_RESTOCKED' : 'STOCK_ADJUSTED',
      title: `Variant ${variants[idx].name}: ${delta > 0 ? '+' : ''}${delta} → ${next}`,
      body: reason,
      metadata: { variantId, delta, from: current, to: next },
    });
    return updated;
  }

  private async maybeWarnLowStock(
    companyId: string,
    product: Product,
    previousStock: number,
    actor: ProductActor,
  ) {
    if (!product.trackInventory || product.reorderLevel <= 0) return;
    // Out-of-stock crossing
    if (previousStock > 0 && product.stock <= 0) {
      await this.logActivity(companyId, product.id, actor, {
        type: 'STOCK_OUT',
        title: 'Out of stock',
        metadata: { stock: product.stock },
      });
      return;
    }
    // Low-stock crossing
    if (
      previousStock > product.reorderLevel &&
      product.stock <= product.reorderLevel &&
      product.stock > 0
    ) {
      await this.logActivity(companyId, product.id, actor, {
        type: 'STOCK_LOW',
        title: `Low stock — ${product.stock} left (reorder at ${product.reorderLevel})`,
        metadata: { stock: product.stock, reorderLevel: product.reorderLevel },
      });
    }
  }

  private async ensureExists(companyId: string, id: string) {
    const found = await prisma.product.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Product not found');
  }

  private buildWhere(companyId: string, f: ListProductsFilters): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = { companyId };
    if (!f.archived) where.archivedAt = null;
    if (f.isActive !== undefined) where.isActive = f.isActive;
    if (f.category) where.category = f.category;
    if (f.tag) where.tags = { has: f.tag };
    if (f.priceMin !== undefined || f.priceMax !== undefined) {
      where.price = {};
      if (f.priceMin !== undefined) where.price.gte = f.priceMin;
      if (f.priceMax !== undefined) where.price.lte = f.priceMax;
    }
    if (f.stockMin !== undefined) where.stock = { gte: f.stockMin };
    if (f.inStockOnly) where.stock = { gt: 0 };
    if (f.search?.trim()) {
      const q = f.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { sku: { contains: q, mode: 'insensitive' } },
        { barcode: { contains: q, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private buildOrderBy(sort?: ListProductsFilters['sort']): Prisma.ProductOrderByWithRelationInput {
    switch (sort) {
      case 'name': return { name: 'asc' };
      case 'price': return { price: 'desc' };
      case 'stock': return { stock: 'asc' };
      case 'sold': return { totalSold: 'desc' };
      case 'recent':
      default: return { updatedAt: 'desc' };
    }
  }

  private async logActivity(
    companyId: string,
    productId: string,
    actor: ProductActor,
    input: AddProductActivityInput,
  ) {
    return prisma.productActivity.create({
      data: {
        productId,
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
