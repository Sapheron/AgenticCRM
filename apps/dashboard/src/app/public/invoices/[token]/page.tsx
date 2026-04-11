'use client';

/**
 * Public hosted invoice viewer — unauthenticated.
 *
 * Fetches via `GET /public/invoices/:token` and renders a clean billing
 * document. View-only (no accept/reject — invoices aren't negotiable).
 * If the invoice is PAID, shows an "Already paid" badge. If OVERDUE,
 * shows a red banner. Payment happens through the existing Payments
 * module via a link the admin sends separately.
 *
 * Lives outside the (dashboard) group so it has no nav, no sidebar, no
 * auth gate. Only invoices in SENT / VIEWED / PARTIALLY_PAID / PAID /
 * OVERDUE are visible — DRAFT / CANCELLED / VOID return 404.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Check, AlertTriangle, Loader2, Receipt } from 'lucide-react';

type InvoiceStatus =
  | 'DRAFT'
  | 'SENT'
  | 'VIEWED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERDUE'
  | 'CANCELLED'
  | 'VOID';

interface PublicInvoice {
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
  dueDate: string | null;
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

const API_ORIGIN =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL
    ? process.env.NEXT_PUBLIC_API_URL
    : '';

function apiUrl(path: string): string {
  if (API_ORIGIN) return `${API_ORIGIN.replace(/\/$/, '')}${path}`;
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const proto = window.location.protocol;
    return `${proto}//${host}:3000${path}`;
  }
  return path;
}

function formatMoney(amount: number, currency = 'INR'): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency}`;
  }
}

export default function PublicInvoicePage() {
  const params = useParams();
  const token = params.token as string;

  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(apiUrl(`/public/invoices/${token}`));
        if (!res.ok) {
          if (!cancelled) {
            setLoadError(
              res.status === 404
                ? 'Invoice not found or no longer available.'
                : `Failed to load invoice (${res.status}).`,
            );
          }
          return;
        }
        const json = (await res.json()) as PublicInvoice;
        if (cancelled) return;
        setInvoice(json);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const isPastDue = useMemo(() => {
    if (!invoice?.dueDate || invoice.amountDue <= 0) return false;
    return new Date(invoice.dueDate).getTime() < Date.now();
  }, [invoice]);

  const layoutClasses =
    'min-h-screen bg-gradient-to-br from-violet-50 via-white to-blue-50 py-10 px-4';

  if (loading) {
    return (
      <div className={layoutClasses + ' flex items-center justify-center'}>
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <Loader2 size={14} className="animate-spin" />
          Loading invoice…
        </div>
      </div>
    );
  }

  if (loadError || !invoice) {
    return (
      <div className={layoutClasses + ' flex items-center justify-center'}>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 max-w-md text-center">
          <AlertTriangle size={28} className="mx-auto mb-3 text-amber-500" />
          <h1 className="text-sm font-semibold text-gray-900 mb-1">Invoice unavailable</h1>
          <p className="text-xs text-gray-500">{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={layoutClasses}>
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="text-[11px] text-gray-400 uppercase tracking-widest">
            {invoice.company.name}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Invoice <span className="font-mono font-medium text-gray-700">{invoice.invoiceNumber}</span>
          </div>
        </div>

        {/* PAID badge */}
        {invoice.status === 'PAID' && (
          <div className="mb-4 flex items-center justify-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <Check size={16} className="text-emerald-600" />
            <span className="text-sm font-semibold text-emerald-800">Paid in full</span>
          </div>
        )}

        {/* OVERDUE banner */}
        {(invoice.status === 'OVERDUE' || (isPastDue && invoice.amountDue > 0)) && (
          <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-4">
            <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">This invoice is overdue</p>
              <p className="text-xs text-red-700 mt-0.5">
                Please arrange payment of{' '}
                <strong>{formatMoney(invoice.amountDue, invoice.currency)}</strong> at your earliest convenience.
              </p>
            </div>
          </div>
        )}

        {/* Main invoice card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-8">
            {invoice.title && (
              <h1 className="text-lg font-semibold text-gray-900 mb-1">{invoice.title}</h1>
            )}
            {invoice.description && (
              <p className="text-sm text-gray-500 mb-6 whitespace-pre-wrap">{invoice.description}</p>
            )}

            {invoice.dueDate && (
              <p
                className={
                  'text-xs rounded px-3 py-2 mb-6 ' +
                  (isPastDue && invoice.amountDue > 0
                    ? 'text-red-700 bg-red-50 border border-red-100'
                    : 'text-amber-700 bg-amber-50 border border-amber-100')
                }
              >
                Due {new Date(invoice.dueDate).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
            )}

            {/* Line items */}
            <table className="w-full mt-2">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Item
                  </th>
                  <th className="text-right py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Qty
                  </th>
                  <th className="text-right py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Unit
                  </th>
                  <th className="text-right py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoice.lineItems.map((li, i) => (
                  <tr key={i}>
                    <td className="py-3">
                      <div className="text-sm text-gray-900">{li.name}</div>
                      {li.description && (
                        <div className="text-[11px] text-gray-400 mt-0.5">{li.description}</div>
                      )}
                      {li.discountBps > 0 && (
                        <div className="text-[10px] text-emerald-600 mt-0.5">
                          {(li.discountBps / 100).toFixed(1)}% discount applied
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-right text-sm text-gray-700 tabular-nums">
                      {li.quantity}
                    </td>
                    <td className="py-3 text-right text-sm text-gray-700 tabular-nums">
                      {formatMoney(li.unitPrice, invoice.currency)}
                    </td>
                    <td className="py-3 text-right text-sm font-medium text-gray-900 tabular-nums">
                      {formatMoney(li.total, invoice.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div className="mt-6 ml-auto w-72 space-y-1.5">
              <div className="flex items-center justify-between text-sm text-gray-500">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatMoney(invoice.subtotal, invoice.currency)}</span>
              </div>
              {invoice.discount > 0 && (
                <div className="flex items-center justify-between text-sm text-emerald-600">
                  <span>Discount</span>
                  <span className="tabular-nums">
                    − {formatMoney(invoice.discount, invoice.currency)}
                  </span>
                </div>
              )}
              {invoice.tax > 0 && (
                <div className="flex items-center justify-between text-sm text-gray-500">
                  <span>Tax ({(invoice.taxBps / 100).toFixed(1)}%)</span>
                  <span className="tabular-nums">{formatMoney(invoice.tax, invoice.currency)}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-2 mt-2 border-t border-gray-200">
                <span className="text-sm font-semibold text-gray-900">Total</span>
                <span className="text-lg font-semibold text-gray-900 tabular-nums">
                  {formatMoney(invoice.total, invoice.currency)}
                </span>
              </div>
              {invoice.amountPaid > 0 && (
                <>
                  <div className="flex items-center justify-between text-xs text-emerald-600">
                    <span>Paid to date</span>
                    <span className="tabular-nums">
                      − {formatMoney(invoice.amountPaid, invoice.currency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-gray-200">
                    <span className="text-sm font-semibold text-gray-900">Amount due</span>
                    <span
                      className={
                        'text-lg font-semibold tabular-nums ' +
                        (invoice.amountDue > 0 ? 'text-amber-700' : 'text-emerald-700')
                      }
                    >
                      {formatMoney(invoice.amountDue, invoice.currency)}
                    </span>
                  </div>
                </>
              )}
            </div>

            {invoice.terms && (
              <div className="mt-8 pt-6 border-t border-gray-100">
                <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Terms
                </h3>
                <p className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">
                  {invoice.terms}
                </p>
              </div>
            )}
          </div>

          {/* Payment instructions footer */}
          {invoice.amountDue > 0 && invoice.status !== 'CANCELLED' && invoice.status !== 'VOID' && (
            <div className="bg-gray-50 border-t border-gray-100 p-6 text-center">
              <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                <Receipt size={12} />
                <span>
                  Payment instructions were sent to you separately. If you haven&apos;t received them,
                  please contact {invoice.company.name}.
                </span>
              </div>
            </div>
          )}
        </div>

        <p className="text-[10px] text-gray-400 text-center mt-6">
          Powered by <span className="font-semibold">Open Agent CRM</span>
        </p>
      </div>
    </div>
  );
}
