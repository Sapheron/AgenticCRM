/**
 * Pure money math for invoices — mirrors `quotes.calc.ts` with adjustments
 * for the invoice number prefix (INV-YYMMDD-XXX) and overdue helper.
 *
 * All amounts are in minor units (paise/cents). Tax + discount are bps
 * (0–10000). Line item total = gross × (1 − discountBps/10000), rounded
 * half-up to the nearest minor unit.
 */

export interface LineItemForCalc {
  quantity: number;
  unitPrice: number;
  discountBps?: number;
}

export interface InvoiceTotalsInput {
  lineItems: LineItemForCalc[];
  discount?: number;
  taxBps?: number;
}

export interface InvoiceTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

export function lineItemTotal(
  quantity: number,
  unitPrice: number,
  discountBps = 0,
): number {
  const q = Math.max(0, Math.floor(quantity));
  const p = Math.max(0, Math.floor(unitPrice));
  const gross = q * p;
  const d = Math.min(10_000, Math.max(0, Math.floor(discountBps)));
  if (d === 0) return gross;
  return Math.round(gross - (gross * d) / 10_000);
}

export function computeInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  let subtotal = 0;
  for (const li of input.lineItems) {
    subtotal += lineItemTotal(li.quantity, li.unitPrice, li.discountBps);
  }
  const rawDiscount = Math.max(0, Math.floor(input.discount ?? 0));
  const discount = Math.min(subtotal, rawDiscount);
  const taxBase = Math.max(0, subtotal - discount);
  const taxBps = Math.max(0, Math.min(10_000, Math.floor(input.taxBps ?? 0)));
  const tax = Math.round((taxBase * taxBps) / 10_000);
  const total = taxBase + tax;
  return { subtotal, discount, tax, total };
}

/** Format a minor-unit amount as a human-readable currency string. */
export function formatMinor(amount: number, currency = 'INR'): string {
  const major = amount / 100;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency}`;
  }
}

/** `INV-YYMMDD-XXX` format. Callers check uniqueness + retry. */
export function generateInvoiceNumber(now: Date = new Date()): string {
  const yy = String(now.getFullYear() % 100).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `INV-${yy}${mm}${dd}-${rand}`;
}

/**
 * True when the invoice is past its due date AND not fully paid.
 * Used by `markOverdue` + the list filter.
 */
export function isOverdue(
  dueDate: Date | null,
  amountPaid: number,
  total: number,
  now: Date = new Date(),
): boolean {
  if (!dueDate) return false;
  if (amountPaid >= total) return false;
  return now.getTime() > dueDate.getTime();
}
