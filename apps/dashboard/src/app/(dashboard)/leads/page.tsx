'use client';

/**
 * Leads list page — full filter rail + stats strip + bulk select toolbar +
 * table / kanban view switcher. Detail view lives at /leads/[id].
 *
 * Every action mirrors what the AI tools can do in the chat panel: filters,
 * sort, bulk status / assign / delete / tag, and inline status changes.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { formatRelativeTime, cn } from '@/lib/utils';
import {
  Plus, Search, X, Trash2, KanbanSquare, Table as TableIcon,
  TrendingUp, Award, Flame, Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { LeadKanban } from './kanban';

export interface Lead {
  id: string;
  title: string;
  status: LeadStatus;
  source: LeadSource;
  priority: LeadPriority;
  score: number;
  probability: number;
  estimatedValue?: number;
  currency: string;
  tags: string[];
  nextActionAt?: string;
  expectedCloseAt?: string;
  contact: { id: string; displayName?: string; phoneNumber: string };
  assignedAgent?: { id: string; firstName: string; lastName: string; avatarUrl?: string };
  updatedAt: string;
  createdAt: string;
}

export type LeadStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'PROPOSAL_SENT' | 'NEGOTIATING' | 'WON' | 'LOST' | 'DISQUALIFIED';
export type LeadSource = 'WHATSAPP' | 'WEBSITE' | 'REFERRAL' | 'INBOUND_EMAIL' | 'OUTBOUND' | 'CAMPAIGN' | 'FORM' | 'IMPORT' | 'AI_CHAT' | 'MANUAL' | 'OTHER';
export type LeadPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

interface Stats {
  rangeDays: number;
  total: number;
  byStatus: Record<string, number>;
  avgScore: number;
  wonCount: number;
  wonValue: number;
  conversionRate: number;
  bySource: Record<string, number>;
}

export const STATUS_COLORS: Record<LeadStatus, string> = {
  NEW: 'bg-blue-50 text-blue-600 border-blue-100',
  CONTACTED: 'bg-amber-50 text-amber-600 border-amber-100',
  QUALIFIED: 'bg-violet-50 text-violet-600 border-violet-100',
  PROPOSAL_SENT: 'bg-orange-50 text-orange-600 border-orange-100',
  NEGOTIATING: 'bg-indigo-50 text-indigo-600 border-indigo-100',
  WON: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  LOST: 'bg-red-50 text-red-600 border-red-100',
  DISQUALIFIED: 'bg-gray-50 text-gray-400 border-gray-100',
};

const PRIORITY_DOTS: Record<LeadPriority, string> = {
  LOW: 'bg-gray-300',
  MEDIUM: 'bg-blue-400',
  HIGH: 'bg-orange-400',
  URGENT: 'bg-red-500',
};

export const STATUSES: LeadStatus[] = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'NEGOTIATING', 'WON', 'LOST', 'DISQUALIFIED'];
export const SOURCES: LeadSource[] = ['WHATSAPP', 'WEBSITE', 'REFERRAL', 'INBOUND_EMAIL', 'OUTBOUND', 'CAMPAIGN', 'FORM', 'IMPORT', 'AI_CHAT', 'MANUAL', 'OTHER'];
const PRIORITIES: LeadPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export default function LeadsPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [filterStatus, setFilterStatus] = useState<LeadStatus | ''>('');
  const [filterSource, setFilterSource] = useState<LeadSource | ''>('');
  const [filterPriority, setFilterPriority] = useState<LeadPriority | ''>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [scoreMin, setScoreMin] = useState('');
  const [sort, setSort] = useState<'recent' | 'score' | 'value' | 'next_action'>('recent');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);

  // Debounce search input
  useMemo(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ['leads', { filterStatus, filterSource, filterPriority, debouncedSearch, scoreMin, sort, page }],
    queryFn: async () => {
      const res = await api.get<{ data: { items: Lead[]; total: number; page: number; limit: number } }>('/leads', {
        params: {
          status: filterStatus || undefined,
          source: filterSource || undefined,
          priority: filterPriority || undefined,
          search: debouncedSearch || undefined,
          scoreMin: scoreMin || undefined,
          sort,
          page,
          limit: 100,
        },
      });
      return res.data.data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['lead-stats'],
    queryFn: async () => {
      const res = await api.get<{ data: Stats }>('/leads/stats', { params: { days: 30 } });
      return res.data.data;
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LeadStatus }) =>
      api.post(`/leads/${id}/status`, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leads'] });
      void qc.invalidateQueries({ queryKey: ['lead-stats'] });
      toast.success('Status updated');
    },
    onError: () => toast.error('Failed to update'),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: LeadStatus }) =>
      api.post('/leads/bulk/status', { ids, status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leads'] });
      void qc.invalidateQueries({ queryKey: ['lead-stats'] });
      setSelected(new Set());
      toast.success('Bulk update applied');
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.post('/leads/bulk/delete', { ids }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leads'] });
      void qc.invalidateQueries({ queryKey: ['lead-stats'] });
      setSelected(new Set());
      toast.success('Deleted');
    },
  });

  const items = data?.items ?? [];
  const allChecked = items.length > 0 && items.every((l) => selected.has(l.id));

  const toggleSelectAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(items.map((l) => l.id)));
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const clearFilters = () => {
    setFilterStatus('');
    setFilterSource('');
    setFilterPriority('');
    setSearch('');
    setScoreMin('');
    setPage(1);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-gray-900">Leads</span>
          {data && <span className="text-[10px] text-gray-400">{data.total} total</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-gray-200 rounded overflow-hidden">
            <button
              onClick={() => setView('table')}
              className={cn('px-2 py-1 text-[10px]', view === 'table' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50')}
              title="Table view"
            >
              <TableIcon size={11} />
            </button>
            <button
              onClick={() => setView('kanban')}
              className={cn('px-2 py-1 text-[10px]', view === 'kanban' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50')}
              title="Kanban view"
            >
              <KanbanSquare size={11} />
            </button>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium"
          >
            <Plus size={11} /> New Lead
          </button>
        </div>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="px-4 py-2 border-b border-gray-100 bg-white shrink-0 grid grid-cols-5 gap-3">
          <StatTile icon={<TrendingUp size={12} />} label="Total (30d)" value={String(stats.total)} accent="text-violet-600" />
          <StatTile icon={<Award size={12} />} label="Won" value={String(stats.wonCount)} accent="text-emerald-600" />
          <StatTile icon={<TrendingUp size={12} />} label="Conv. rate" value={`${stats.conversionRate}%`} accent="text-blue-600" />
          <StatTile icon={<Flame size={12} />} label="Avg score" value={String(stats.avgScore)} accent="text-orange-600" />
          <StatTile icon={<Clock size={12} />} label="Won value" value={`₹${stats.wonValue.toLocaleString()}`} accent="text-emerald-600" />
        </div>
      )}

      {/* Filter rail */}
      <div className="border-b border-gray-100 bg-white shrink-0">
        <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 border border-gray-200 rounded px-2 flex-1 max-w-xs">
            <Search size={11} className="text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, contact, notes…"
              className="text-[11px] py-1 w-full focus:outline-none"
            />
          </div>

          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value as LeadStatus | ''); setPage(1); }}
            className="text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>

          <select
            value={filterSource}
            onChange={(e) => { setFilterSource(e.target.value as LeadSource | ''); setPage(1); }}
            className="text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white"
          >
            <option value="">All sources</option>
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <select
            value={filterPriority}
            onChange={(e) => { setFilterPriority(e.target.value as LeadPriority | ''); setPage(1); }}
            className="text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white"
          >
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>

          <input
            type="number"
            value={scoreMin}
            onChange={(e) => { setScoreMin(e.target.value); setPage(1); }}
            placeholder="Min score"
            className="text-[10px] border border-gray-200 rounded px-1.5 py-1 w-20"
          />

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as 'recent' | 'score' | 'value' | 'next_action')}
            className="text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white"
          >
            <option value="recent">Sort: Recent</option>
            <option value="score">Sort: Score</option>
            <option value="value">Sort: Value</option>
            <option value="next_action">Sort: Next action</option>
          </select>

          {(filterStatus || filterSource || filterPriority || debouncedSearch || scoreMin) && (
            <button onClick={clearFilters} className="text-[10px] text-gray-400 hover:text-gray-700 flex items-center gap-1">
              <X size={10} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Bulk action toolbar */}
      {selected.size > 0 && (
        <div className="px-4 py-1.5 bg-violet-50 border-b border-violet-100 flex items-center gap-3 shrink-0">
          <span className="text-[11px] text-violet-700 font-medium">{selected.size} selected</span>
          <select
            onChange={(e) => {
              if (e.target.value) {
                bulkStatusMutation.mutate({ ids: [...selected], status: e.target.value as LeadStatus });
                e.target.value = '';
              }
            }}
            className="text-[10px] border border-violet-200 rounded px-1.5 py-0.5 bg-white"
          >
            <option value="">Set status…</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <button
            onClick={() => {
              if (confirm(`Delete ${selected.size} leads?`)) bulkDeleteMutation.mutate([...selected]);
            }}
            className="text-[10px] text-red-600 hover:text-red-700 flex items-center gap-1"
          >
            <Trash2 size={10} /> Delete
          </button>
          <button onClick={() => setSelected(new Set())} className="text-[10px] text-gray-500 ml-auto">
            Clear
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {view === 'kanban' ? (
          <LeadKanban leads={items} onStatusChange={(id, status) => updateStatusMutation.mutate({ id, status })} />
        ) : isLoading ? (
          <div className="p-8 text-center text-gray-300 text-xs">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-xs text-gray-400 mb-2">No leads match those filters.</p>
            <button onClick={clearFilters} className="text-[11px] text-violet-600 hover:text-violet-700">Clear filters</button>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200 sticky top-0">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input type="checkbox" checked={allChecked} onChange={toggleSelectAll} className="h-3 w-3" />
                </th>
                {['Lead', 'Contact', 'Status', 'Score', 'Value', 'Source', 'Next', 'Updated'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {items.map((lead) => {
                const overdue = lead.nextActionAt && new Date(lead.nextActionAt) < new Date();
                return (
                  <tr key={lead.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(lead.id)}
                        onChange={() => toggleOne(lead.id)}
                        className="h-3 w-3"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/leads/${lead.id}`} className="text-xs font-medium text-gray-900 hover:text-violet-600 flex items-center gap-1.5">
                        <span className={cn('w-1.5 h-1.5 rounded-full', PRIORITY_DOTS[lead.priority])} title={lead.priority} />
                        {lead.title}
                      </Link>
                      {lead.tags.length > 0 && (
                        <div className="flex gap-1 mt-0.5">
                          {lead.tags.slice(0, 3).map((t) => (
                            <span key={t} className="text-[9px] bg-gray-100 text-gray-500 px-1 rounded">{t}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {lead.contact?.displayName ?? lead.contact?.phoneNumber ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={lead.status}
                        onChange={(e) => updateStatusMutation.mutate({ id: lead.id, status: e.target.value as LeadStatus })}
                        className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium cursor-pointer', STATUS_COLORS[lead.status])}
                      >
                        {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <div className="w-12 bg-gray-100 rounded-full h-1">
                          <div
                            className={cn('h-1 rounded-full', lead.score >= 70 ? 'bg-emerald-500' : lead.score >= 40 ? 'bg-violet-500' : 'bg-gray-300')}
                            style={{ width: `${lead.score}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-gray-400 w-5 text-right">{lead.score}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {lead.estimatedValue ? `${lead.currency} ${lead.estimatedValue.toLocaleString()}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-gray-400">{lead.source}</td>
                    <td className="px-3 py-2">
                      {lead.nextActionAt ? (
                        <span className={cn('text-[10px]', overdue ? 'text-red-600 font-medium' : 'text-gray-400')}>
                          {new Date(lead.nextActionAt).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[10px] text-gray-300">{formatRelativeTime(lead.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="h-9 border-t border-gray-200 px-3 flex items-center justify-between shrink-0 bg-white">
        <span className="text-[10px] text-gray-400">{data?.total ?? 0} leads</span>
        {data && data.total > 100 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="text-[10px] text-gray-500 disabled:opacity-30 px-1"
            >
              Prev
            </button>
            <span className="text-[10px] text-gray-400">page {page}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={items.length < 100}
              className="text-[10px] text-gray-500 disabled:opacity-30 px-1"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {showCreate && <CreateLeadModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

// ── Stats tile ────────────────────────────────────────────────────────────

function StatTile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <div className="border border-gray-100 rounded px-3 py-1.5">
      <div className="flex items-center gap-1 text-[9px] text-gray-400 uppercase tracking-wider">
        {icon} {label}
      </div>
      <div className={cn('text-sm font-semibold mt-0.5', accent)}>{value}</div>
    </div>
  );
}

// ── Create modal (inline so we don't proliferate files) ────────────────────

function CreateLeadModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [contactName, setContactName] = useState('');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [source, setSource] = useState<LeadSource>('MANUAL');
  const [priority, setPriority] = useState<LeadPriority>('MEDIUM');
  const [tagsRaw, setTagsRaw] = useState('');
  const [expectedCloseAt, setExpectedCloseAt] = useState('');
  const [force, setForce] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/leads', {
        title,
        phoneNumber: phoneNumber || undefined,
        contactName: contactName || undefined,
        source,
        priority,
        estimatedValue: estimatedValue ? Number(estimatedValue) : undefined,
        tags: tagsRaw.split(',').map((t) => t.trim()).filter(Boolean),
        expectedCloseAt: expectedCloseAt || undefined,
        force,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leads'] });
      void qc.invalidateQueries({ queryKey: ['lead-stats'] });
      toast.success('Lead created');
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err && typeof err === 'object' && 'response' in err
        ? ((err as { response?: { data?: { message?: string } } }).response?.data?.message)
        : null) ?? 'Failed to create';
      toast.error(msg);
    },
  });

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[460px] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold">New Lead</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        </div>

        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lead title (required)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />

        <div className="grid grid-cols-2 gap-2">
          <input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="Contact phone" className="border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Contact name (opt)" className="border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select value={source} onChange={(e) => setSource(e.target.value as LeadSource)} className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white">
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value as LeadPriority)} className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white">
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} placeholder="Value (₹)" type="number" className="border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <input value={expectedCloseAt} onChange={(e) => setExpectedCloseAt(e.target.value)} type="date" className="border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
        </div>

        <input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="Tags (comma-separated)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />

        <label className="flex items-center gap-1.5 text-[10px] text-gray-500">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="h-3 w-3" />
          Force create (bypass duplicate check)
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-gray-500 text-[11px] px-2 py-1">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!title || mutation.isPending}
            className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30"
          >
            {mutation.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
