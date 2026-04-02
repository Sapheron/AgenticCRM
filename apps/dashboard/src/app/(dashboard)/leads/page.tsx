'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { formatRelativeTime, cn } from '@/lib/utils';
import { TrendingUp, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface Lead {
  id: string;
  title: string;
  status: string;
  source?: string;
  score: number;
  estimatedValue?: number;
  currency: string;
  contact: { id: string; displayName?: string; phoneNumber: string };
  assignedAgent?: { firstName: string; lastName: string };
  updatedAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  NEW: 'bg-blue-100 text-blue-700',
  CONTACTED: 'bg-yellow-100 text-yellow-700',
  QUALIFIED: 'bg-purple-100 text-purple-700',
  PROPOSAL_SENT: 'bg-orange-100 text-orange-700',
  NEGOTIATING: 'bg-indigo-100 text-indigo-700',
  WON: 'bg-green-100 text-green-700',
  LOST: 'bg-red-100 text-red-700',
  DISQUALIFIED: 'bg-gray-100 text-gray-500',
};

const STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'NEGOTIATING', 'WON', 'LOST', 'DISQUALIFIED'];

export default function LeadsPage() {
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage] = useState(1);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['leads', filterStatus, page],
    queryFn: async () => {
      const res = await api.get<{ data: { items: Lead[]; total: number } }>('/leads', {
        params: { status: filterStatus || undefined, page },
      });
      return res.data.data;
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await api.post(`/leads/${id}/status`, { status });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leads'] });
      toast.success('Lead status updated');
    },
    onError: () => toast.error('Failed to update status'),
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Leads</h1>
        <button className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <Plus size={14} />
          Add Lead
        </button>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          onClick={() => { setFilterStatus(''); setPage(1); }}
          className={cn('text-xs px-3 py-1 rounded-full border transition', !filterStatus ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400')}
        >
          All
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => { setFilterStatus(s); setPage(1); }}
            className={cn('text-xs px-3 py-1 rounded-full border transition', filterStatus === s ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400')}
          >
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Loading…</div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Lead', 'Contact', 'Status', 'Score', 'Value', 'Source', 'Updated'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data?.items.map((lead) => (
                <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <TrendingUp size={14} className="text-green-500 shrink-0" />
                      <span className="text-sm font-medium text-gray-900">{lead.title}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {lead.contact.displayName ?? lead.contact.phoneNumber}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={lead.status}
                      onChange={(e) => updateStatusMutation.mutate({ id: lead.id, status: e.target.value })}
                      className={cn('text-xs px-2 py-1 rounded-full border-0 font-medium cursor-pointer', STATUS_COLORS[lead.status] ?? 'bg-gray-100 text-gray-600')}
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${lead.score}%` }} />
                      </div>
                      <span className="text-xs text-gray-500">{lead.score}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {lead.estimatedValue ? `${lead.currency} ${lead.estimatedValue.toLocaleString()}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{lead.source ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{formatRelativeTime(lead.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="px-4 py-3 border-t text-sm text-gray-500">
          Total: {data?.total ?? 0} leads
        </div>
      </div>
    </div>
  );
}
