'use client';

/**
 * Invoices list — filter rail + stats strip + bulk-select toolbar + table.
 * Matches /leads, /deals, /campaigns, /forms, /quotes.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { formatRelativeTime, cn } from '@/lib/utils';
import {
  Receipt,
  Plus,
  Search,
  X,
  Trash2,
  Send,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

type InvoiceStatus =
  | 'DRAFT'
  | 'SENT'
  | 'VIEWED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERDUE'
  | 'CANCELLED'
  | 'VOID';

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  title: string | null;
  status: InvoiceStatus;
  contactId: string | null;
  dealId: string | null;
  fromQuoteId: string | null;
  currency: string;
  subtotal: number;
  total: number;
  amountPaid: number;
  dueDate: string | null;
  tags: string[];
  lineItems: Array<{ id: string; name: string }>;
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  rangeDays: number;
  totalInvoices: number;
  byStatus: Record<string, number>;
  outstanding: number;
  overdue: number;
  collected: number;
  collectionRate: number | null;
  averageTotal: number | null;
}

const STATUS_COLORS: Record<InvoiceStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-500',
  SENT: 'bg-blue-50 text-blue-600',
  VIEWED: 'bg-violet-50 text-violet-700',
  PARTIALLY_PAID: 'bg-amber-50 text-amber-700',
  PAID: 'bg-emerald-50 text-emerald-700',
  OVERDUE: 'bg-red-50 text-red-600',
  CANCELLED: 'bg-gray-50 text-gray-400',
  VOID: 'bg-gray-50 text-gray-400',
};

const ALL_STATUSES: InvoiceStatus[] = [
  'DRAFT',
  'SENT',
  'VIEWED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'CANCELLED',
  'VOID',
];

function formatMoney(amount: number, currency = 'INR'): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency}`;
  }
}

export default function InvoicesPage() {
  const qc = useQueryClient();
  const [selectedStatuses, setSelectedStatuses] = useState<Set<InvoiceStatus>>(new Set());
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);

  const { data: stats } = useQuery({
    queryKey: ['invoice-stats'],
    queryFn: async () => {
      const r = await api.get<{ data: Stats }>('/invoices/stats');
      return r.data.data;
    },
  });

  const queryKey = useMemo(
    () => ['invoices', [...selectedStatuses].join(','), search],
    [selectedStatuses, search],
  );
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedStatuses.size > 0) params.set('status', [...selectedStatuses].join(','));
      if (search) params.set('search', search);
      params.set('limit', '100');
      const r = await api.get<{ data: { items: InvoiceRow[]; total: number } }>(
        `/invoices?${params.toString()}`,
      );
      return r.data.data;
    },
  });

  const invalidateAfterBulk = () => {
    void qc.invalidateQueries({ queryKey: ['invoices'] });
    void qc.invalidateQueries({ queryKey: ['invoice-stats'] });
    setSelectedIds(new Set());
  };
  const bulkSend = useMutation({
    mutationFn: () => api.post('/invoices/bulk/send', { ids: [...selectedIds] }),
    onSuccess: () => {
      invalidateAfterBulk();
      toast.success('Bulk send complete');
    },
    onError: () => toast.error('Bulk send failed'),
  });
  const bulkCancel = useMutation({
    mutationFn: () => api.post('/invoices/bulk/cancel', { ids: [...selectedIds] }),
    onSuccess: () => {
      invalidateAfterBulk();
      toast.success('Bulk cancel complete');
    },
    onError: () => toast.error('Bulk cancel failed'),
  });
  const bulkDelete = useMutation({
    mutationFn: () => api.post('/invoices/bulk/delete', { ids: [...selectedIds] }),
    onSuccess: () => {
      invalidateAfterBulk();
      toast.success('Bulk delete complete');
    },
    onError: () => toast.error('Bulk delete failed'),
  });

  const sendMutation = useMutation({
    mutationFn: (id: string) => api.post(`/invoices/${id}/send`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Sent');
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      toast.error(msg ?? 'Send failed');
    },
  });

  const toggleStatus = (s: InvoiceStatus) => {
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const allSelected = items.length > 0 && items.every((i) => selectedIds.has(i.id));
  // `Date.now()` is impure — stash it in state so the render stays deterministic.
  // Updates once per query refresh which is plenty for an overdue-flag check.
  const [now] = useState(() => Date.now());

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2">
          <Receipt size={14} className="text-violet-500" />
          <span className="text-xs font-semibold text-gray-900">Invoices</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoices..."
              className="w-52 pl-6 pr-2 py-1 text-[11px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium"
          >
            <Plus size={11} /> New Invoice
          </button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-5 gap-2 border-b border-gray-200 bg-white px-4 py-2.5 shrink-0">
          <StatTile label="Total" value={stats.totalInvoices} />
          <StatTile label="Outstanding" value={formatMoney(stats.outstanding)} tint="blue" />
          <StatTile label="Overdue" value={formatMoney(stats.overdue)} tint="red" />
          <StatTile label="Collected" value={formatMoney(stats.collected)} tint="emerald" />
          <StatTile
            label="Collection rate"
            value={stats.collectionRate !== null ? `${stats.collectionRate}%` : '—'}
            tint="violet"
          />
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <aside className="w-48 border-r border-gray-200 bg-white overflow-auto shrink-0 p-3 space-y-4">
          <div>
            <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-1.5 font-medium">
              Status
            </p>
            <div className="space-y-1">
              {ALL_STATUSES.map((s) => (
                <label key={s} className="flex items-center gap-2 cursor-pointer text-[11px]">
                  <input
                    type="checkbox"
                    checked={selectedStatuses.has(s)}
                    onChange={() => toggleStatus(s)}
                    className="accent-violet-500 w-3 h-3"
                  />
                  <span className={cn('px-1.5 py-0.5 rounded text-[10px]', STATUS_COLORS[s])}>
                    {s}
                  </span>
                </label>
              ))}
            </div>
          </div>
          {(selectedStatuses.size > 0 || search) && (
            <button
              onClick={() => {
                setSelectedStatuses(new Set());
                setSearch('');
              }}
              className="flex items-center gap-1 text-[10px] text-violet-600 hover:text-violet-700"
            >
              <X size={10} /> Clear filters
            </button>
          )}
        </aside>

        <main className="flex-1 flex flex-col min-w-0 bg-white">
          {selectedIds.size > 0 && (
            <div className="h-9 border-b border-gray-200 px-3 flex items-center gap-3 shrink-0 bg-violet-50">
              <span className="text-[11px] text-violet-700 font-medium">
                {selectedIds.size} selected
              </span>
              <div className="flex-1" />
              <button
                onClick={() => bulkSend.mutate()}
                className="flex items-center gap-1 text-[11px] text-gray-700 hover:text-gray-900 px-2 py-1 rounded hover:bg-white"
              >
                <Send size={11} /> Send
              </button>
              <button
                onClick={() => bulkCancel.mutate()}
                className="flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-800 px-2 py-1 rounded hover:bg-white"
              >
                <XCircle size={11} /> Cancel
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete ${selectedIds.size} invoice(s)?`)) bulkDelete.mutate();
                }}
                className="flex items-center gap-1 text-[11px] text-red-700 hover:text-red-800 px-2 py-1 rounded hover:bg-white"
              >
                <Trash2 size={11} /> Delete
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-[11px] text-gray-400 hover:text-gray-600 px-2"
              >
                <X size={11} />
              </button>
            </div>
          )}

          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="p-8 text-center text-gray-300 text-xs">Loading...</div>
            ) : items.length === 0 ? (
              <div className="p-12 text-center text-gray-300">
                <Receipt size={28} className="mx-auto mb-2 text-gray-200" />
                <p className="text-xs">No invoices match.</p>
                <p className="text-[10px] mt-1">
                  Click <strong>New Invoice</strong> to create one.
                </p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50/80 border-b border-gray-200 sticky top-0 z-10">
                  <tr>
                    <th className="w-8 px-2 py-2">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedIds(new Set(items.map((i) => i.id)));
                          else setSelectedIds(new Set());
                        }}
                        className="accent-violet-500 w-3 h-3"
                      />
                    </th>
                    {['Number', 'Title', 'Status', 'Total', 'Paid / Due', 'Due date', 'Updated', ''].map(
                      (h) => (
                        <th
                          key={h}
                          className="text-left px-2 py-2 text-[9px] font-medium text-gray-400 uppercase tracking-wider"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((inv) => {
                    const due = inv.total - inv.amountPaid;
                    const progress = inv.total > 0 ? (inv.amountPaid / inv.total) * 100 : 0;
                    const isPastDue =
                      inv.dueDate && new Date(inv.dueDate).getTime() < now && due > 0;
                    return (
                      <tr key={inv.id} className="hover:bg-gray-50/50">
                        <td className="px-2 py-2 w-8">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(inv.id)}
                            onChange={() => toggleSelect(inv.id)}
                            className="accent-violet-500 w-3 h-3"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Link
                            href={`/invoices/${inv.id}`}
                            className="text-xs font-medium text-gray-900 hover:text-violet-600 font-mono"
                          >
                            {inv.invoiceNumber}
                          </Link>
                          {inv.fromQuoteId && (
                            <div className="text-[9px] text-gray-400">from quote</div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-[11px] text-gray-700 max-w-xs truncate">
                          {inv.title ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-2 py-2">
                          <span
                            className={cn(
                              'text-[9px] px-1.5 py-0.5 rounded font-medium',
                              STATUS_COLORS[inv.status],
                            )}
                          >
                            {inv.status}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-[11px] text-gray-900 tabular-nums">
                          {formatMoney(inv.total, inv.currency)}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5">
                            <div className="w-14 h-1 bg-gray-100 rounded overflow-hidden">
                              <div
                                className="h-full bg-emerald-500 rounded"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-gray-500 tabular-nums">
                              {formatMoney(inv.amountPaid, inv.currency)}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          {inv.dueDate ? (
                            <div
                              className={cn(
                                'text-[10px] flex items-center gap-1',
                                isPastDue ? 'text-red-600' : 'text-gray-400',
                              )}
                            >
                              {isPastDue && <AlertTriangle size={9} />}
                              {new Date(inv.dueDate).toLocaleDateString()}
                            </div>
                          ) : (
                            <span className="text-[10px] text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-[10px] text-gray-400">
                          {formatRelativeTime(inv.updatedAt)}
                        </td>
                        <td className="px-2 py-2">
                          {inv.status === 'DRAFT' && (
                            <button
                              onClick={() => sendMutation.mutate(inv.id)}
                              title="Send"
                              className="text-blue-600 hover:text-blue-700 p-0.5"
                            >
                              <Send size={11} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="h-8 border-t border-gray-200 px-3 flex items-center shrink-0 bg-white">
            <span className="text-[10px] text-gray-400">
              {items.length} of {total} invoice{total === 1 ? '' : 's'}
            </span>
          </div>
        </main>
      </div>

      {showCreate && (
        <CreateInvoiceModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['invoices'] });
            void qc.invalidateQueries({ queryKey: ['invoice-stats'] });
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  tint,
}: {
  label: string;
  value: string | number;
  tint?: 'emerald' | 'blue' | 'violet' | 'red';
}) {
  const tints: Record<string, string> = {
    emerald: 'text-emerald-600',
    blue: 'text-blue-600',
    violet: 'text-violet-600',
    red: 'text-red-600',
  };
  return (
    <div className="bg-gray-50/80 border border-gray-100 rounded px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-widest text-gray-400 font-medium">{label}</div>
      <div className={cn('text-sm font-semibold tabular-nums', tint ? tints[tint] : 'text-gray-900')}>
        {value}
      </div>
    </div>
  );
}

function CreateInvoiceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [taxBps, setTaxBps] = useState('1800');
  const [dueDate, setDueDate] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/invoices', {
        title: title || undefined,
        contactId: contactId || undefined,
        currency,
        taxBps: Number(taxBps) || 0,
        dueDate: dueDate || undefined,
      }),
    onSuccess: () => {
      toast.success('Invoice created in DRAFT');
      onCreated();
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      toast.error(msg ?? 'Failed to create');
    },
  });

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[480px] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold">New Invoice</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)"
          className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
          autoFocus
        />
        <input
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
          placeholder="Contact id (optional — can be set later)"
          className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400 font-mono"
        />
        <div className="grid grid-cols-3 gap-2">
          <label className="text-[10px] text-gray-500">
            <span className="block uppercase tracking-widest mb-0.5">Currency</span>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs"
            >
              <option value="INR">INR</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="AED">AED</option>
            </select>
          </label>
          <label className="text-[10px] text-gray-500">
            <span className="block uppercase tracking-widest mb-0.5">Tax (bps)</span>
            <input
              type="number"
              value={taxBps}
              onChange={(e) => setTaxBps(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs"
              placeholder="1800 = 18%"
            />
          </label>
          <label className="text-[10px] text-gray-500">
            <span className="block uppercase tracking-widest mb-0.5">Due date</span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs"
            />
          </label>
        </div>
        <p className="text-[10px] text-gray-400">
          You&apos;ll add line items on the detail page after creating.
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-gray-500 text-[11px] px-2 py-1">
            Cancel
          </button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30"
          >
            {createMutation.isPending ? 'Creating…' : 'Create as Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}
