/**
 * Shared types for the Invoices module — mirrors `quotes.types.ts` shape.
 * All money is in minor units (paise/cents). Tax is bps (0-10000).
 */
import type {
  InvoiceActivityType,
  InvoiceStatus,
} from '@wacrm/database';

export type InvoiceActor =
  | { type: 'user'; userId: string }
  | { type: 'ai' }
  | { type: 'system' }
  | { type: 'worker' }
  | { type: 'public' };

export interface LineItemInput {
  productId?: string;
  name: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
  discountBps?: number;
}

export interface CreateInvoiceDto {
  contactId?: string;
  dealId?: string;
  fromQuoteId?: string;
  title?: string;
  description?: string;
  invoiceNumber?: string;
  taxBps?: number;
  discount?: number;
  currency?: string;
  dueDate?: string | Date;
  notes?: string;
  terms?: string;
  tags?: string[];
  lineItems?: LineItemInput[];
}

export interface UpdateInvoiceDto {
  title?: string | null;
  description?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  taxBps?: number;
  discount?: number;
  currency?: string;
  dueDate?: string | Date | null;
  notes?: string | null;
  terms?: string | null;
  tags?: string[];
}

export interface ListInvoicesFilters {
  status?: InvoiceStatus | InvoiceStatus[];
  contactId?: string;
  dealId?: string;
  tag?: string;
  search?: string;
  /** Invoices where dueDate <= this (used for "overdue now" and "due this week"). */
  dueBefore?: string | Date;
  createdFrom?: string | Date;
  createdTo?: string | Date;
  sort?: 'recent' | 'total' | 'number' | 'due_date' | 'amount_due';
  page?: number;
  limit?: number;
}

export interface RecordPaymentDto {
  amount: number;
  /** Optional — if the payment already went through the Payments module */
  paymentId?: string;
  note?: string;
}

export interface AddInvoiceActivityInput {
  type: InvoiceActivityType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export interface InvoiceStatsSnapshot {
  rangeDays: number;
  totalInvoices: number;
  byStatus: Record<string, number>;
  /** Sum of all (total - amountPaid) across non-terminal statuses. */
  outstanding: number;
  /** Sum of total for invoices currently OVERDUE. */
  overdue: number;
  /** Sum of amountPaid for all invoices created in range. */
  collected: number;
  /** collected / total — percentage 0..100, or null. */
  collectionRate: number | null;
  averageTotal: number | null;
}

export interface PublicInvoiceDefinition {
  id: string;
  invoiceNumber: string;
  title: string | null;
  description: string | null;
  status: InvoiceStatus;
  subtotal: number;
  tax: number;
  taxBps: number;
  discount: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  currency: string;
  dueDate: Date | null;
  terms: string | null;
  lineItems: Array<{
    name: string;
    description: string | null;
    quantity: number;
    unitPrice: number;
    discountBps: number;
    total: number;
  }>;
  company: {
    name: string;
  };
}

export interface BulkMutationResult {
  updated: number;
  failed: number;
  errors: Array<{ id: string; reason: string }>;
}
