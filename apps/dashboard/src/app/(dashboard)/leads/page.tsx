'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { formatRelativeTime, cn } from '@/lib/utils';
import { Plus } from 'lucide-react';
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
  NEW: 'bg-blue-50 text-blue-600',
  CONTACTED: 'bg-amber-50 text-amber-600',
  QUALIFIED: 'bg-violet-50 text-violet-600',
  PROPOSAL_SENT: 'bg-orange-50 text-orange-600',
  NEGOTIATING: 'bg-indigo-50 text-indigo-600',
  WON: 'bg-emerald-50 text-emerald-600',
  LOST: 'bg-red-50 text-red-600',
  DISQUALIFIED: 'bg-gray-50 text-gray-400',
};

const STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'NEGOTIATING', 'WON', 'LOST', 'DISQUALIFIED'];

export default function LeadsPage() {
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [source, setSource] = useState('');
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
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['leads'] }); toast.success('Status updated'); },
    onError: () => toast.error('Failed to update'),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/leads', { title, estimatedValue: Number(estimatedValue), source }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leads'] });
      toast.success('Lead created');
      setShowForm(false); setTitle(''); setEstimatedValue(''); setSource('');
    },
    onError: () => toast.error('Failed to create lead'),
  });

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <span className="text-xs font-semibold text-gray-900">Leads</span>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium">
          <Plus size={11} />
          Add
        </button>
      </div>

      {showForm && (
        <div className="border-b border-gray-200 bg-white p-3 space-y-2 shrink-0">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lead title (required)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <input value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} placeholder="Estimated value" type="number" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <div className="flex gap-2">
            <button onClick={() => createMutation.mutate()} disabled={!title} className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30">Create</button>
            <button onClick={() => setShowForm(false)} className="text-gray-400 text-[11px] px-2 py-1">Cancel</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="px-3 py-2 flex gap-1 flex-wrap border-b border-gray-100 bg-white shrink-0">
        <button
          onClick={() => { setFilterStatus(''); setPage(1); }}
          className={cn('text-[10px] px-2 py-0.5 rounded transition', !filterStatus ? 'bg-gray-900 text-white' : 'text-gray-400 hover:bg-gray-100')}
        >
          All
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => { setFilterStatus(s); setPage(1); }}
            className={cn('text-[10px] px-2 py-0.5 rounded transition', filterStatus === s ? 'bg-gray-900 text-white' : 'text-gray-400 hover:bg-gray-100')}
          >
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-8 text-center text-gray-300 text-xs">Loading...</div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200 sticky top-0">
              <tr>
                {['Lead', 'Contact', 'Status', 'Score', 'Value', 'Source', 'Updated'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {data?.items.map((lead) => (
                <tr key={lead.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-3 py-2 text-xs font-medium text-gray-900">{lead.title}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {lead.contact?.displayName ?? lead.contact?.phoneNumber ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={lead.status}
                      onChange={(e) => updateStatusMutation.mutate({ id: lead.id, status: e.target.value })}
                      className={cn('text-[10px] px-1.5 py-0.5 rounded border-0 font-medium cursor-pointer', STATUS_COLORS[lead.status] ?? 'bg-gray-50 text-gray-400')}
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-12 bg-gray-100 rounded-full h-1">
                        <div className="bg-violet-500 h-1 rounded-full" style={{ width: `${lead.score}%` }} />
                      </div>
                      <span className="text-[10px] text-gray-400">{lead.score}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {lead.estimatedValue ? `${lead.currency} ${lead.estimatedValue.toLocaleString()}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-gray-400">{lead.source ?? '—'}</td>
                  <td className="px-3 py-2 text-[10px] text-gray-300">{formatRelativeTime(lead.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="h-9 border-t border-gray-200 px-3 flex items-center shrink-0 bg-white">
        <span className="text-[10px] text-gray-400">{data?.total ?? 0} leads</span>
      </div>
    </div>
  );
}
