'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { formatCurrency, formatRelativeTime, cn } from '@/lib/utils';
import { CreditCard, ExternalLink } from 'lucide-react';

interface Payment {
  id: string;
  provider: string;
  amount: number;
  currency: string;
  description?: string;
  status: string;
  linkUrl?: string;
  paidAt?: string;
  createdAt: string;
  contact?: { displayName?: string; phoneNumber: string };
  deal?: { title: string };
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  PAID: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  REFUNDED: 'bg-gray-100 text-gray-600',
  EXPIRED: 'bg-gray-100 text-gray-500',
};

export default function PaymentsPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['payments', page],
    queryFn: async () => {
      const res = await api.get<{ data: { items: Payment[]; total: number } }>('/payments', { params: { page } });
      return res.data.data;
    },
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Payments</h1>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Loading…</div>
        ) : !data?.items.length ? (
          <div className="p-12 text-center">
            <CreditCard size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-400">No payments yet</p>
            <p className="text-xs text-gray-400 mt-1">Payment links are created automatically by the AI when customers want to pay.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Contact', 'Description', 'Amount', 'Provider', 'Status', 'Link', 'Created'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.items.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {p.contact?.displayName ?? p.contact?.phoneNumber ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">{p.description ?? '—'}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-gray-900">
                    {formatCurrency(p.amount, p.currency)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{p.provider}</td>
                  <td className="px-4 py-3">
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_COLORS[p.status] ?? 'bg-gray-100 text-gray-600')}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {p.linkUrl ? (
                      <a href={p.linkUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-xs">
                        Open <ExternalLink size={10} />
                      </a>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">{formatRelativeTime(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && (
          <div className="px-4 py-3 border-t text-sm text-gray-500">
            Total: {data.total} payments
          </div>
        )}
      </div>
    </div>
  );
}
