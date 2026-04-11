/**
 * Invoices service — single write path for every invoice mutation.
 *
 * Mirrors QuotesService / CampaignsService / FormsService: every
 * state-changing method ends with `logActivity` so we get a complete
 * audit trail in `InvoiceActivity` attributed to the original actor
 * (user/ai/system/worker/public).
 *
 * Lifecycle: DRAFT → SENT → VIEWED → PARTIALLY_PAID → PAID /
 * OVERDUE / CANCELLED / VOID. VOID is terminal; CANCELLED can be
 * followed by DELETE. The hot path is `recordPayment()` which bumps
 * `amountPaid` and auto-transitions status when the invoice is fully
 * paid.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { prisma } from '@wacrm/database';
import type {
  Prisma,
  Invoice,
  InvoiceActivityType,
  InvoiceLineItem,
  InvoiceStatus,
} from '@wacrm/database';

import {
  computeInvoiceTotals,
  generateInvoiceNumber,
  lineItemTotal,
} from './invoices.calc';
import type {
  AddInvoiceActivityInput,
  BulkMutationResult,
  CreateInvoiceDto,
  InvoiceActor,
  InvoiceStatsSnapshot,
  LineItemInput,
  ListInvoicesFilters,
  PublicInvoiceDefinition,
  UpdateInvoiceDto,
} from './invoices.types';

const EDITABLE_STATUSES: InvoiceStatus[] = ['DRAFT', 'SENT'];
const PUBLIC_VIEWABLE_STATUSES: InvoiceStatus[] = [
  'SENT',
  'VIEWED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
];

@Injectable()
export class InvoicesService {
  // ── Reads ─────────────────────────────────────────────────────────────

  async list(companyId: string, filters: ListInvoicesFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    const where: Prisma.InvoiceWhereInput = { companyId };

    if (filters.status) {
      where.status = Array.isArray(filters.status)
        ? { in: filters.status }
        : filters.status;
    }
    if (filters.contactId) where.contactId = filters.contactId;
    if (filters.dealId) where.dealId = filters.dealId;
    if (filters.tag) where.tags = { has: filters.tag };
    if (filters.dueBefore) {
      where.dueDate = { lte: new Date(filters.dueBefore) };
    }
    if (filters.createdFrom || filters.createdTo) {
      where.createdAt = {};
      if (filters.createdFrom) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(filters.createdFrom);
      if (filters.createdTo) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(filters.createdTo);
    }
    if (filters.search) {
      const q = filters.search;
      where.OR = [
        { invoiceNumber: { contains: q, mode: 'insensitive' } },
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { notes: { contains: q, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.InvoiceOrderByWithRelationInput =
      filters.sort === 'total'
        ? { total: 'desc' }
        : filters.sort === 'number'
          ? { invoiceNumber: 'asc' }
          : filters.sort === 'due_date'
            ? { dueDate: 'asc' }
            : { createdAt: 'desc' };

    const [items, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          lineItems: { orderBy: { sortOrder: 'asc' } },
        },
      }),
      prisma.invoice.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async get(companyId: string, id: string) {
    const record = await prisma.invoice.findFirst({
      where: { id, companyId },
      include: {
        lineItems: { orderBy: { sortOrder: 'asc' } },
        activities: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!record) throw new NotFoundException('Invoice not found');
    return record;
  }

  async getTimeline(companyId: string, id: string, limit = 100) {
    await this.getRaw(companyId, id);
    return prisma.invoiceActivity.findMany({
      where: { invoiceId: id, companyId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, Math.max(1, limit)),
    });
  }

  async stats(companyId: string, days = 30): Promise<InvoiceStatsSnapshot> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const invoices = await prisma.invoice.findMany({
      where: { companyId, createdAt: { gte: since } },
      select: { status: true, total: true, amountPaid: true },
    });

    const byStatus: Record<string, number> = {};
    let outstanding = 0;
    let overdue = 0;
    let collected = 0;
    let totalSum = 0;
    for (const inv of invoices) {
      byStatus[inv.status] = (byStatus[inv.status] ?? 0) + 1;
      totalSum += inv.total;
      collected += inv.amountPaid;
      if (inv.status === 'OVERDUE') {
        overdue += inv.total - inv.amountPaid;
      }
      if (
        inv.status === 'SENT' ||
        inv.status === 'VIEWED' ||
        inv.status === 'PARTIALLY_PAID' ||
        inv.status === 'OVERDUE'
      ) {
        outstanding += inv.total - inv.amountPaid;
      }
    }

    return {
      rangeDays: days,
      totalInvoices: invoices.length,
      byStatus,
      outstanding,
      overdue,
      collected,
      collectionRate:
        totalSum > 0 ? Math.round((collected / totalSum) * 1000) / 10 : null,
      averageTotal:
        invoices.length > 0 ? Math.round(totalSum / invoices.length) : null,
    };
  }

  /** Public view — token lookup. Scrubbed + status-gated. */
  async getPublicByToken(token: string): Promise<PublicInvoiceDefinition | null> {
    const record = await prisma.invoice.findUnique({
      where: { publicToken: token },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!record) return null;
    if (!PUBLIC_VIEWABLE_STATUSES.includes(record.status)) return null;

    const company = await prisma.company.findUnique({
      where: { id: record.companyId },
      select: { name: true },
    });

    return {
      id: record.id,
      invoiceNumber: record.invoiceNumber,
      title: record.title,
      description: record.description,
      status: record.status,
      subtotal: record.subtotal,
      tax: record.tax,
      taxBps: record.taxBps,
      discount: record.discount,
      total: record.total,
      amountPaid: record.amountPaid,
      amountDue: record.total - record.amountPaid,
      currency: record.currency,
      dueDate: record.dueDate,
      terms: record.terms,
      lineItems: record.lineItems.map((li) => ({
        name: li.name,
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        discountBps: li.discountBps,
        total: li.total,
      })),
      company: { name: company?.name ?? 'Unknown' },
    };
  }

  // ── Writes ────────────────────────────────────────────────────────────

  async create(
    companyId: string,
    actor: InvoiceActor,
    dto: CreateInvoiceDto,
  ): Promise<Invoice> {
    const invoiceNumber =
      dto.invoiceNumber?.trim() || (await this.uniqueInvoiceNumber(companyId));
    const publicToken = randomBytes(16).toString('hex');

    const lineItems = dto.lineItems ?? [];
    const totals = computeInvoiceTotals({
      lineItems: lineItems.map((li) => ({
        quantity: li.quantity ?? 1,
        unitPrice: li.unitPrice ?? 0,
        discountBps: li.discountBps ?? 0,
      })),
      discount: dto.discount,
      taxBps: dto.taxBps,
    });

    const invoice = await prisma.invoice.create({
      data: {
        companyId,
        contactId: dto.contactId,
        dealId: dto.dealId,
        fromQuoteId: dto.fromQuoteId,
        invoiceNumber,
        publicToken,
        title: dto.title,
        description: dto.description,
        subtotal: totals.subtotal,
        tax: totals.tax,
        taxBps: dto.taxBps ?? 0,
        discount: totals.discount,
        total: totals.total,
        amountPaid: 0,
        currency: dto.currency ?? 'INR',
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        notes: dto.notes,
        terms: dto.terms,
        tags: dto.tags ?? [],
        createdByUserId: actor.type === 'user' ? actor.userId : null,
        lineItems: {
          create: lineItems.map((li, i) => ({
            sortOrder: i + 1,
            productId: li.productId,
            name: li.name,
            description: li.description,
            quantity: li.quantity ?? 1,
            unitPrice: li.unitPrice ?? 0,
            discountBps: li.discountBps ?? 0,
            total: lineItemTotal(
              li.quantity ?? 1,
              li.unitPrice ?? 0,
              li.discountBps ?? 0,
            ),
          })),
        },
      },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.logActivity(companyId, invoice.id, actor, {
      type: 'CREATED',
      title: `Invoice ${invoice.invoiceNumber} created`,
      metadata: { total: invoice.total, lineItemCount: lineItems.length },
    });
    return invoice;
  }

  async update(
    companyId: string,
    id: string,
    actor: InvoiceActor,
    dto: UpdateInvoiceDto,
  ): Promise<Invoice> {
    const existing = await this.getRaw(companyId, id);
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new BadRequestException(
        `Cannot edit an invoice in status ${existing.status}. Cancel or void it first.`,
      );
    }

    const data: Prisma.InvoiceUpdateInput = {};
    const diffs: Array<{ field: string; from: unknown; to: unknown }> = [];

    const assign = <K extends keyof UpdateInvoiceDto>(field: K) => {
      if (dto[field] === undefined) return;
      const newVal = dto[field];
      const oldVal = (existing as unknown as Record<string, unknown>)[field as string];
      if (newVal !== oldVal) {
        diffs.push({ field: field as string, from: oldVal, to: newVal });
        if (field === 'dueDate') {
          data.dueDate = newVal ? new Date(newVal as string | Date) : null;
        } else if (field === 'contactId') {
          data.contactId = newVal as string | null;
        } else if (field === 'dealId') {
          data.dealId = newVal as string | null;
        } else {
          (data as Record<string, unknown>)[field as string] = newVal;
        }
      }
    };
    assign('title');
    assign('description');
    assign('contactId');
    assign('dealId');
    assign('currency');
    assign('dueDate');
    assign('notes');
    assign('terms');
    assign('tags');

    const taxChanged = dto.taxBps !== undefined && dto.taxBps !== existing.taxBps;
    const discountChanged = dto.discount !== undefined && dto.discount !== existing.discount;
    if (taxChanged || discountChanged) {
      const lineItems = await prisma.invoiceLineItem.findMany({
        where: { invoiceId: id },
        select: { quantity: true, unitPrice: true, discountBps: true },
      });
      const totals = computeInvoiceTotals({
        lineItems,
        discount: dto.discount ?? existing.discount,
        taxBps: dto.taxBps ?? existing.taxBps,
      });
      data.subtotal = totals.subtotal;
      data.tax = totals.tax;
      data.taxBps = dto.taxBps ?? existing.taxBps;
      data.discount = totals.discount;
      data.total = totals.total;
      if (taxChanged) diffs.push({ field: 'taxBps', from: existing.taxBps, to: dto.taxBps });
      if (discountChanged) diffs.push({ field: 'discount', from: existing.discount, to: dto.discount });
    }

    if (diffs.length === 0) return existing;

    const updated = await prisma.invoice.update({
      where: { id },
      data,
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });

    for (const d of diffs) {
      await this.logActivity(companyId, id, actor, {
        type: d.field === 'title' ? 'RENAMED' : 'FIELD_UPDATED',
        title: `${d.field} updated`,
        body: `${safeDisplay(d.from)} → ${safeDisplay(d.to)}`,
        metadata: { field: d.field, from: d.from, to: d.to },
      });
    }
    return updated;
  }

  async addLineItem(
    companyId: string,
    id: string,
    actor: InvoiceActor,
    item: LineItemInput,
  ): Promise<Invoice> {
    const existing = await this.getRaw(companyId, id);
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new BadRequestException(`Cannot edit an invoice in status ${existing.status}`);
    }
    const maxOrder = await prisma.invoiceLineItem.aggregate({
      where: { invoiceId: id },
      _max: { sortOrder: true },
    });
    const sortOrder = (maxOrder._max.sortOrder ?? 0) + 1;
    await prisma.invoiceLineItem.create({
      data: {
        invoiceId: id,
        sortOrder,
        productId: item.productId,
        name: item.name,
        description: item.description,
        quantity: item.quantity ?? 1,
        unitPrice: item.unitPrice ?? 0,
        discountBps: item.discountBps ?? 0,
        total: lineItemTotal(
          item.quantity ?? 1,
          item.unitPrice ?? 0,
          item.discountBps ?? 0,
        ),
      },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'LINE_ITEM_ADDED',
      title: `Added "${item.name}"`,
      metadata: { name: item.name, quantity: item.quantity, unitPrice: item.unitPrice },
    });
    return this.recomputeAndReturn(companyId, id, actor);
  }

  async removeLineItem(
    companyId: string,
    id: string,
    actor: InvoiceActor,
    lineItemId: string,
  ): Promise<Invoice> {
    const existing = await this.getRaw(companyId, id);
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new BadRequestException(`Cannot edit an invoice in status ${existing.status}`);
    }
    const li = await prisma.invoiceLineItem.findFirst({
      where: { id: lineItemId, invoiceId: id },
    });
    if (!li) throw new NotFoundException('Line item not found');
    await prisma.invoiceLineItem.delete({ where: { id: lineItemId } });
    await this.logActivity(companyId, id, actor, {
      type: 'LINE_ITEM_REMOVED',
      title: `Removed "${li.name}"`,
      metadata: { name: li.name },
    });
    return this.recomputeAndReturn(companyId, id, actor);
  }

  async updateLineItem(
    companyId: string,
    id: string,
    actor: InvoiceActor,
    lineItemId: string,
    patch: Partial<LineItemInput>,
  ): Promise<Invoice> {
    const existing = await this.getRaw(companyId, id);
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new BadRequestException(`Cannot edit an invoice in status ${existing.status}`);
    }
    const li = await prisma.invoiceLineItem.findFirst({
      where: { id: lineItemId, invoiceId: id },
    });
    if (!li) throw new NotFoundException('Line item not found');

    const data: Prisma.InvoiceLineItemUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.productId !== undefined) data.productId = patch.productId;
    if (patch.quantity !== undefined) data.quantity = patch.quantity;
    if (patch.unitPrice !== undefined) data.unitPrice = patch.unitPrice;
    if (patch.discountBps !== undefined) data.discountBps = patch.discountBps;

    const q = patch.quantity ?? li.quantity;
    const p = patch.unitPrice ?? li.unitPrice;
    const d = patch.discountBps ?? li.discountBps;
    data.total = lineItemTotal(q, p, d);

    await prisma.invoiceLineItem.update({ where: { id: lineItemId }, data });
    await this.logActivity(companyId, id, actor, {
      type: 'LINE_ITEM_UPDATED',
      title: `Updated "${li.name}"`,
      metadata: { fields: Object.keys(patch) },
    });
    return this.recomputeAndReturn(companyId, id, actor);
  }

  async send(
    companyId: string,
    id: string,
    actor: InvoiceActor,
  ): Promise<Invoice> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status !== 'DRAFT' && existing.status !== 'SENT') {
      throw new BadRequestException(
        `Cannot send an invoice in status ${existing.status}`,
      );
    }
    const lineItemCount = await prisma.invoiceLineItem.count({ where: { invoiceId: id } });
    if (lineItemCount === 0) {
      throw new BadRequestException('Add at least one line item before sending');
    }
    const updated = await prisma.invoice.update({
      where: { id },
      data: {
        status: 'SENT',
        sentAt: existing.sentAt ?? new Date(),
      },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'SENT',
      title: 'Invoice sent',
      metadata: { lineItemCount },
    });
    return updated;
  }

  async markViewed(token: string): Promise<void> {
    const invoice = await prisma.invoice.findUnique({
      where: { publicToken: token },
      select: { id: true, companyId: true, status: true },
    });
    if (!invoice) return;
    if (invoice.status !== 'SENT') return;
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'VIEWED', viewedAt: new Date() },
    });
    await this.logActivity(invoice.companyId, invoice.id, { type: 'public' }, {
      type: 'VIEWED_BY_CUSTOMER',
      title: 'Customer opened the invoice',
    });
  }

  /**
   * Record a payment against an invoice. Called by admin chat, manual
   * controller action, and (Phase 2) by the Payments webhook hook.
   *
   * Bumps `amountPaid`, transitions status:
   *   amountPaid === 0           → no change
   *   0 < amountPaid < total     → PARTIALLY_PAID
   *   amountPaid >= total        → PAID (stamps paidAt)
   */
  async recordPayment(
    companyId: string,
    id: string,
    actor: InvoiceActor,
    amount: number,
    meta: { paymentId?: string; note?: string } = {},
  ): Promise<Invoice> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('amount must be a positive integer (minor units)');
    }
    const existing = await this.getRaw(companyId, id);
    if (existing.status === 'CANCELLED' || existing.status === 'VOID') {
      throw new BadRequestException(
        `Cannot record payment on an ${existing.status} invoice`,
      );
    }
    const newPaid = existing.amountPaid + Math.floor(amount);
    let nextStatus: InvoiceStatus = existing.status;
    let paidAt: Date | undefined;
    if (newPaid >= existing.total) {
      nextStatus = 'PAID';
      paidAt = new Date();
    } else if (newPaid > 0) {
      nextStatus = 'PARTIALLY_PAID';
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: {
        amountPaid: Math.min(newPaid, existing.total * 2), // cap absurd overpayments
        status: nextStatus,
        ...(paidAt ? { paidAt } : {}),
      },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });

    await this.logActivity(companyId, id, actor, {
      type: 'PAYMENT_RECORDED',
      title: `Payment recorded — ${amount} (${existing.currency})`,
      body: meta.note,
      metadata: {
        amount,
        paymentId: meta.paymentId,
        newAmountPaid: newPaid,
        nextStatus,
      },
    });

    if (nextStatus === 'PAID') {
      await this.logActivity(companyId, id, actor, {
        type: 'MARKED_PAID',
        title: 'Invoice fully paid',
      });
    }

    return updated;
  }

  async markPaid(
    companyId: string,
    id: string,
    actor: InvoiceActor,
  ): Promise<Invoice> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status === 'PAID') return existing;
    if (existing.status === 'CANCELLED' || existing.status === 'VOID') {
      throw new BadRequestException(
        `Cannot mark a ${existing.status} invoice as paid`,
      );
    }
    const updated = await prisma.invoice.update({
      where: { id },
      data: {
        status: 'PAID',
        amountPaid: existing.total,
        paidAt: new Date(),
      },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'MARKED_PAID',
      title: 'Marked as paid',
    });
    return updated;
  }

  async markOverdue(
    companyId: string,
    id: string,
    actor: InvoiceActor,
  ): Promise<Invoice> {
    const existing = await this.getRaw(companyId, id);
    if (
      existing.status !== 'SENT' &&
      existing.status !== 'VIEWED' &&
      existing.status !== 'PARTIALLY_PAID'
    ) {
      throw new BadRequestException(
        `Only SENT/VIEWED/PARTIALLY_PAID invoices can be marked overdue (current: ${existing.status})`,
      );
    }
    const updated = await prisma.invoice.update({
      where: { id },
      data: { status: 'OVERDUE' },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'MARKED_OVERDUE',
      title: 'Marked overdue',
    });
    return updated;
  }

  async cancel(
    companyId: string,
    id: string,
    actor: InvoiceActor,
    reason?: string,
  ): Promise<Invoice> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status === 'PAID' || existing.status === 'VOID') {
      throw new BadRequestException(`Cannot cancel a ${existing.status} invoice`);
    }
    const updated = await prisma.invoice.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'CANCELLED',
      title: 'Invoice cancelled',
      body: reason,
      metadata: { reason },
    });
    return updated;
  }

  async voidInvoice(
    companyId: string,
    id: string,
    actor: InvoiceActor,
    reason?: string,
  ): Promise<Invoice> {
    const existing = await this.getRaw(companyId, id);
    if (existing.status === 'VOID') return existing;
    const updated = await prisma.invoice.update({
      where: { id },
      data: { status: 'VOID', voidedAt: new Date(), cancelReason: reason },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'VOIDED',
      title: 'Invoice voided',
      body: reason,
      metadata: { reason },
    });
    return updated;
  }

  async duplicate(
    companyId: string,
    id: string,
    actor: InvoiceActor,
  ): Promise<Invoice> {
    const src = await prisma.invoice.findFirst({
      where: { id, companyId },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!src) throw new NotFoundException('Invoice not found');

    const newNumber = await this.uniqueInvoiceNumber(companyId);
    const newToken = randomBytes(16).toString('hex');

    const dup = await prisma.invoice.create({
      data: {
        companyId,
        contactId: src.contactId,
        dealId: src.dealId,
        invoiceNumber: newNumber,
        publicToken: newToken,
        title: src.title,
        description: src.description,
        subtotal: src.subtotal,
        tax: src.tax,
        taxBps: src.taxBps,
        discount: src.discount,
        total: src.total,
        amountPaid: 0,
        currency: src.currency,
        notes: src.notes,
        terms: src.terms,
        tags: src.tags,
        createdByUserId: actor.type === 'user' ? actor.userId : null,
        lineItems: {
          create: src.lineItems.map((li) => ({
            sortOrder: li.sortOrder,
            productId: li.productId,
            name: li.name,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            discountBps: li.discountBps,
            total: li.total,
          })),
        },
      },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.logActivity(companyId, dup.id, actor, {
      type: 'DUPLICATED',
      title: `Duplicated from ${src.invoiceNumber}`,
      metadata: { sourceInvoiceId: src.id },
    });
    return dup;
  }

  /**
   * Convert an ACCEPTED Quote to a DRAFT Invoice. Copies line items,
   * totals, contact, deal, terms. The resulting invoice links back via
   * `fromQuoteId` so the detail page can deep-link to the source.
   */
  async createFromQuote(
    companyId: string,
    quoteId: string,
    actor: InvoiceActor,
  ): Promise<Invoice> {
    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, companyId },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!quote) throw new NotFoundException('Quote not found');
    if (quote.status !== 'ACCEPTED') {
      throw new BadRequestException(
        `Only ACCEPTED quotes can be converted (current: ${quote.status})`,
      );
    }
    const invoiceNumber = await this.uniqueInvoiceNumber(companyId);
    const publicToken = randomBytes(16).toString('hex');

    const invoice = await prisma.invoice.create({
      data: {
        companyId,
        contactId: quote.contactId,
        dealId: quote.dealId,
        fromQuoteId: quote.id,
        invoiceNumber,
        publicToken,
        title: quote.title ?? `Invoice for ${quote.quoteNumber}`,
        description: quote.description,
        subtotal: quote.subtotal,
        tax: quote.tax,
        taxBps: quote.taxBps,
        discount: quote.discount,
        total: quote.total,
        amountPaid: 0,
        currency: quote.currency,
        notes: quote.notes,
        terms: quote.terms,
        tags: quote.tags,
        createdByUserId: actor.type === 'user' ? actor.userId : null,
        lineItems: {
          create: quote.lineItems.map((li) => ({
            sortOrder: li.sortOrder,
            productId: li.productId,
            name: li.name,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            discountBps: li.discountBps,
            total: li.total,
          })),
        },
      },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.logActivity(companyId, invoice.id, actor, {
      type: 'CONVERTED_FROM_QUOTE',
      title: `Converted from quote ${quote.quoteNumber}`,
      metadata: { quoteId: quote.id, quoteNumber: quote.quoteNumber },
    });
    return invoice;
  }

  async addNote(
    companyId: string,
    id: string,
    actor: InvoiceActor,
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
      existing.status !== 'VOID'
    ) {
      throw new BadRequestException(
        `Only DRAFT, CANCELLED, or VOID invoices can be deleted (current: ${existing.status})`,
      );
    }
    await prisma.invoice.delete({ where: { id } });
  }

  // ── Bulk ops ──────────────────────────────────────────────────────────

  async bulkSend(
    companyId: string,
    ids: string[],
    actor: InvoiceActor,
  ): Promise<BulkMutationResult> {
    return this.runBulk(ids, (id) => this.send(companyId, id, actor));
  }

  async bulkCancel(
    companyId: string,
    ids: string[],
    actor: InvoiceActor,
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

  // ── Helpers ───────────────────────────────────────────────────────────

  private async getRaw(companyId: string, id: string): Promise<Invoice> {
    const record = await prisma.invoice.findFirst({ where: { id, companyId } });
    if (!record) throw new NotFoundException('Invoice not found');
    return record;
  }

  private async recomputeAndReturn(
    companyId: string,
    id: string,
    actor: InvoiceActor,
  ): Promise<Invoice> {
    const lineItems = await prisma.invoiceLineItem.findMany({
      where: { invoiceId: id },
      select: { quantity: true, unitPrice: true, discountBps: true },
    });
    const existing = await this.getRaw(companyId, id);
    const totals = computeInvoiceTotals({
      lineItems,
      discount: existing.discount,
      taxBps: existing.taxBps,
    });
    const updated = await prisma.invoice.update({
      where: { id },
      data: {
        subtotal: totals.subtotal,
        tax: totals.tax,
        discount: totals.discount,
        total: totals.total,
      },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'TOTALS_RECALCULATED',
      title: 'Totals recomputed',
      metadata: {
        subtotal: totals.subtotal,
        tax: totals.tax,
        discount: totals.discount,
        total: totals.total,
      },
    });
    return updated;
  }

  private async uniqueInvoiceNumber(companyId: string): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const candidate = generateInvoiceNumber();
      const existing = await prisma.invoice.findUnique({
        where: { companyId_invoiceNumber: { companyId, invoiceNumber: candidate } },
      });
      if (!existing) return candidate;
    }
    return `INV-${Date.now()}-${randomBytes(3).toString('hex')}`;
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
    invoiceId: string,
    actor: InvoiceActor,
    input: AddInvoiceActivityInput,
  ) {
    return prisma.invoiceActivity.create({
      data: {
        invoiceId,
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

// Type-guard to silence unused-import warnings for enum types used
// only through downstream inference.
const _TYPE_GUARD: Array<InvoiceActivityType | InvoiceLineItem> = [];
void _TYPE_GUARD;

function safeDisplay(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.join(', ') || '[]';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
