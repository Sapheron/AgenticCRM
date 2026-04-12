'use client';

/**
 * Tickets list — filter rail + stats strip + bulk-select toolbar + table.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { formatRelativeTime, cn } from '@/lib/utils';
import {
  LifeBuoy,
  Plus,
  Search,
  X,
  Trash2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface TicketRow {
  id: string;
  ticketNumber: string;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  category: string | null;
  source: string;
  contactId: string | null;
  assignedToId: string | null;
  tags: string[];
  slaFirstResponseBreached: boolean;
  slaResolutionBreached: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { comments: number };
}

interface Stats {
  rangeDays: number;
  totalTickets: number;
  openTickets: number;
  resolvedTickets: number;
  avgFirstResponseMins: number | null;
  avgResolutionMins: number | null;
  slaBreachCount: number;
}

const STATUS_COLORS: Record<TicketStatus, string> = {
  OPEN: 'bg-blue-50 text-blue-600',
  IN_PROGRESS: 'bg-violet-50 text-violet-700',
  WAITING: 'bg-amber-50 text-amber-600',
  ESCALATED: 'bg-red-50 text-red-600',
  RESOLVED: 'bg-emerald-50 text-emerald-700',
  CLOSED: 'bg-gray-50 text-gray-400',
};

const PRIORITY_COLORS: Record<TicketPriority, string> = {
  LOW: 'text-gray-400',
  MEDIUM: 'text-blue-600',
  HIGH: 'text-amber-600',
  CRITICAL: 'text-red-600',
};

const ALL_STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING', 'ESCALATED', 'RESOLVED', 'CLOSED'];
const ALL_PRIORITIES: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export default function TicketsPage() {
  const qc = useQueryClient();
  const [selectedStatuses, setSelectedStatuses] = useState<Set<TicketStatus>>(new Set());
  const [selectedPriorities, setSelectedPriorities] = useState<Set<TicketPriority>>(new Set());
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);

  const { data: stats } = useQuery({
    queryKey: ['ticket-stats'],
    queryFn: async () => {
      const r = await api.get<{ data: Stats }>('/tickets/stats');
      return r.data.data;
    },
  });

  const queryKey = useMemo(
    () => ['tickets', [...selectedStatuses].join(','), [...selectedPriorities].join(','), search],
    [selectedStatuses, selectedPriorities, search],
  );
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedStatuses.size > 0) params.set('status', [...selectedStatuses].join(','));
      if (selectedPriorities.size > 0) params.set('priority', [...selectedPriorities].join(','));
      if (search) params.set('search', search);
      params.set('limit', '100');
      const r = await api.get<{ data: { items: TicketRow[]; total: number } }>(
        `/tickets?${params.toString()}`,
      );
      return r.data.data;
    },
  });

  const invalidateAfterBulk = () => {
    void qc.invalidateQueries({ queryKey: ['tickets'] });
    void qc.invalidateQueries({ queryKey: ['ticket-stats'] });
    setSelectedIds(new Set());
  };
  const bulkClose = useMutation({
    mutationFn: () => api.post('/tickets/bulk/close', { ids: [...selectedIds] }),
    onSuccess: () => { invalidateAfterBulk(); toast.success('Bulk close complete'); },
    onError: () => toast.error('Bulk close failed'),
  });
  const bulkDelete = useMutation({
    mutationFn: () => api.post('/tickets/bulk/delete', { ids: [...selectedIds] }),
    onSuccess: () => { invalidateAfterBulk(); toast.success('Bulk delete complete'); },
    onError: () => toast.error('Bulk delete failed'),
  });

  const toggleStatus = (s: TicketStatus) => {
    setSelectedStatuses((prev) => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  };
  const togglePriority = (p: TicketPriority) => {
    setSelectedPriorities((prev) => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  };
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const allSelected = items.length > 0 && items.every((t) => selectedIds.has(t.id));

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2">
          <LifeBuoy size={14} className="text-violet-500" />
          <span className="text-xs font-semibold text-gray-900">Tickets</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets..." className="w-52 pl-6 pr-2 py-1 text-[11px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-violet-400" />
          </div>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium">
            <Plus size={11} /> New Ticket
          </button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-5 gap-2 border-b border-gray-200 bg-white px-4 py-2.5 shrink-0">
          <StatTile label="Total" value={stats.totalTickets} />
          <StatTile label="Open" value={stats.openTickets} tint="blue" />
          <StatTile label="Resolved" value={stats.resolvedTickets} tint="emerald" />
          <StatTile label="Avg response" value={stats.avgFirstResponseMins !== null ? `${stats.avgFirstResponseMins}m` : '—'} tint="violet" />
          <StatTile label="SLA breaches" value={stats.slaBreachCount} tint={stats.slaBreachCount > 0 ? 'red' : undefined} />
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <aside className="w-48 border-r border-gray-200 bg-white overflow-auto shrink-0 p-3 space-y-4">
          <div>
            <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-1.5 font-medium">Status</p>
            <div className="space-y-1">
              {ALL_STATUSES.map((s) => (
                <label key={s} className="flex items-center gap-2 cursor-pointer text-[11px]">
                  <input type="checkbox" checked={selectedStatuses.has(s)} onChange={() => toggleStatus(s)} className="accent-violet-500 w-3 h-3" />
                  <span className={cn('px-1.5 py-0.5 rounded text-[10px]', STATUS_COLORS[s])}>{s}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-1.5 font-medium">Priority</p>
            <div className="space-y-1">
              {ALL_PRIORITIES.map((p) => (
                <label key={p} className="flex items-center gap-2 cursor-pointer text-[11px]">
                  <input type="checkbox" checked={selectedPriorities.has(p)} onChange={() => togglePriority(p)} className="accent-violet-500 w-3 h-3" />
                  <span className={cn('text-[10px]', PRIORITY_COLORS[p])}>{p}</span>
                </label>
              ))}
            </div>
          </div>
          {(selectedStatuses.size > 0 || selectedPriorities.size > 0 || search) && (
            <button onClick={() => { setSelectedStatuses(new Set()); setSelectedPriorities(new Set()); setSearch(''); }} className="flex items-center gap-1 text-[10px] text-violet-600 hover:text-violet-700">
              <X size={10} /> Clear filters
            </button>
          )}
        </aside>

        <main className="flex-1 flex flex-col min-w-0 bg-white">
          {selectedIds.size > 0 && (
            <div className="h-9 border-b border-gray-200 px-3 flex items-center gap-3 shrink-0 bg-violet-50">
              <span className="text-[11px] text-violet-700 font-medium">{selectedIds.size} selected</span>
              <div className="flex-1" />
              <button onClick={() => bulkClose.mutate()} className="flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-800 px-2 py-1 rounded hover:bg-white"><XCircle size={11} /> Close</button>
              <button onClick={() => { if (confirm(`Delete ${selectedIds.size} ticket(s)?`)) bulkDelete.mutate(); }} className="flex items-center gap-1 text-[11px] text-red-700 hover:text-red-800 px-2 py-1 rounded hover:bg-white"><Trash2 size={11} /> Delete</button>
              <button onClick={() => setSelectedIds(new Set())} className="text-[11px] text-gray-400 hover:text-gray-600 px-2"><X size={11} /></button>
            </div>
          )}

          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="p-8 text-center text-gray-300 text-xs">Loading...</div>
            ) : items.length === 0 ? (
              <div className="p-12 text-center text-gray-300">
                <LifeBuoy size={28} className="mx-auto mb-2 text-gray-200" />
                <p className="text-xs">No tickets match.</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50/80 border-b border-gray-200 sticky top-0 z-10">
                  <tr>
                    <th className="w-8 px-2 py-2">
                      <input type="checkbox" checked={allSelected} onChange={(e) => { if (e.target.checked) setSelectedIds(new Set(items.map((t) => t.id))); else setSelectedIds(new Set()); }} className="accent-violet-500 w-3 h-3" />
                    </th>
                    {['Number', 'Title', 'Status', 'Priority', 'Category', 'SLA', 'Updated'].map((h) => (
                      <th key={h} className="text-left px-2 py-2 text-[9px] font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((t) => {
                    const breached = t.slaFirstResponseBreached || t.slaResolutionBreached;
                    return (
                      <tr key={t.id} className="hover:bg-gray-50/50">
                        <td className="px-2 py-2 w-8">
                          <input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleSelect(t.id)} className="accent-violet-500 w-3 h-3" />
                        </td>
                        <td className="px-2 py-2">
                          <Link href={`/tickets/${t.id}`} className="text-xs font-medium text-gray-900 hover:text-violet-600 font-mono">
                            {t.ticketNumber}
                          </Link>
                        </td>
                        <td className="px-2 py-2 text-[11px] text-gray-700 max-w-xs truncate">{t.title}</td>
                        <td className="px-2 py-2">
                          <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium', STATUS_COLORS[t.status])}>{t.status}</span>
                        </td>
                        <td className="px-2 py-2">
                          <span className={cn('text-[10px] font-medium', PRIORITY_COLORS[t.priority])}>{t.priority}</span>
                        </td>
                        <td className="px-2 py-2 text-[10px] text-gray-500">{t.category ?? '—'}</td>
                        <td className="px-2 py-2">
                          {breached ? (
                            <span className="flex items-center gap-1 text-[9px] text-red-600"><AlertTriangle size={9} /> Breached</span>
                          ) : (
                            <span className="text-[10px] text-gray-300">OK</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-[10px] text-gray-400">{formatRelativeTime(t.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="h-8 border-t border-gray-200 px-3 flex items-center shrink-0 bg-white">
            <span className="text-[10px] text-gray-400">{items.length} of {total} ticket{total === 1 ? '' : 's'}</span>
          </div>
        </main>
      </div>

      {showCreate && (
        <CreateTicketModal onClose={() => setShowCreate(false)} onCreated={() => {
          void qc.invalidateQueries({ queryKey: ['tickets'] });
          void qc.invalidateQueries({ queryKey: ['ticket-stats'] });
          setShowCreate(false);
        }} />
      )}
    </div>
  );
}

function StatTile({ label, value, tint }: { label: string; value: string | number; tint?: 'emerald' | 'blue' | 'violet' | 'red' }) {
  const tints: Record<string, string> = { emerald: 'text-emerald-600', blue: 'text-blue-600', violet: 'text-violet-600', red: 'text-red-600' };
  return (
    <div className="bg-gray-50/80 border border-gray-100 rounded px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-widest text-gray-400 font-medium">{label}</div>
      <div className={cn('text-sm font-semibold tabular-nums', tint ? tints[tint] : 'text-gray-900')}>{value}</div>
    </div>
  );
}

function CreateTicketModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [category, setCategory] = useState('');

  const createM = useMutation({
    mutationFn: () => api.post('/tickets', { title, description: description || undefined, priority, category: category || undefined }),
    onSuccess: () => { toast.success('Ticket created'); onCreated(); },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { message?: string } } }).response?.data?.message : null;
      toast.error(msg ?? 'Failed');
    },
  });

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[480px] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold">New Ticket</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (required)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" autoFocus />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={3} className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] text-gray-500">
            <span className="block uppercase tracking-widest mb-0.5">Priority</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs">
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </label>
          <label className="text-[10px] text-gray-500">
            <span className="block uppercase tracking-widest mb-0.5">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs">
              <option value="">General</option>
              <option value="bug">Bug</option>
              <option value="feature">Feature</option>
              <option value="billing">Billing</option>
              <option value="support">Support</option>
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-gray-500 text-[11px] px-2 py-1">Cancel</button>
          <button onClick={() => createM.mutate()} disabled={!title.trim() || createM.isPending} className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30">
            {createM.isPending ? 'Creating…' : 'Create Ticket'}
          </button>
        </div>
      </div>
    </div>
  );
}
