'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  Plus, Search, X, FileBarChart, Archive, Trash2,
  CheckSquare, Square, Play, Clock, MoreHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────

type ReportStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
type ReportType = 'TABLE' | 'CHART' | 'FUNNEL' | 'METRIC' | 'COHORT';

interface ReportItem {
  id: string;
  name: string;
  entity: string;
  type: ReportType;
  status: ReportStatus;
  description?: string;
  tags: string[];
  isPublic: boolean;
  lastRunAt?: string;
  createdAt: string;
}

interface StatsSnapshot {
  total: number;
  active: number;
  draft: number;
  archived: number;
  scheduled: number;
  totalRuns: number;
}

interface ListResult {
  total: number;
  page: number;
  limit: number;
  items: ReportItem[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<ReportStatus, string> = {
  DRAFT:    'bg-gray-100 text-gray-500',
  ACTIVE:   'bg-emerald-50 text-emerald-600',
  ARCHIVED: 'bg-red-50 text-red-400',
};

const TYPE_COLORS: Record<ReportType, string> = {
  TABLE:  'bg-gray-50 text-gray-700',
  CHART:  'bg-gray-50 text-gray-900',
  FUNNEL: 'bg-amber-50 text-amber-600',
  METRIC: 'bg-emerald-50 text-emerald-600',
  COHORT: 'bg-pink-50 text-pink-600',
};

const ENTITIES = ['contacts', 'leads', 'deals', 'tickets', 'invoices', 'payments', 'tasks'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex flex-col gap-0.5 min-w-[90px]">
      <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">{label}</span>
      <span className="text-xl font-bold text-gray-900 leading-none">{value}</span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const qc = useQueryClient();
  const router = useRouter();

  // Filters
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatus]   = useState<ReportStatus | ''>('');
  const [typeFilter, setType]       = useState<ReportType | ''>('');
  const [entityFilter, setEntity]   = useState('');
  const [sort, setSort]             = useState<'recent' | 'name'>('recent');
  const [page, setPage]             = useState(1);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName]       = useState('');
  const [newEntity, setNewEntity]   = useState('contacts');
  const [newType, setNewType]       = useState<ReportType>('TABLE');
  const [newDesc, setNewDesc]       = useState('');

  // Bulk
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Queries ───────────────────────────────────────────────────────────────────

  const { data: stats } = useQuery<StatsSnapshot>({
    queryKey: ['report-stats'],
    queryFn: async () => {
      const r = await api.get<{ data: StatsSnapshot }>('/reports/stats');
      return r.data.data;
    },
  });

  const params = new URLSearchParams();
  if (search)        params.set('search', search);
  if (statusFilter)  params.set('status', statusFilter);
  if (typeFilter)    params.set('type', typeFilter);
  if (entityFilter)  params.set('entity', entityFilter);
  params.set('sort', sort);
  params.set('page', String(page));
  params.set('limit', '25');

  const { data, isLoading } = useQuery<ListResult>({
    queryKey: ['reports', search, statusFilter, typeFilter, entityFilter, sort, page],
    queryFn: async () => {
      const r = await api.get<{ data: ListResult }>(`/reports?${params.toString()}`);
      return r.data.data;
    },
  });

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const createMut = useMutation({
    mutationFn: () => api.post('/reports', {
      name: newName, entity: newEntity, type: newType,
      description: newDesc || undefined,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports'] });
      void qc.invalidateQueries({ queryKey: ['report-stats'] });
      toast.success('Report created');
      setShowCreate(false); setNewName(''); setNewDesc('');
    },
    onError: () => toast.error('Failed to create'),
  });

  const runMut = useMutation({
    mutationFn: (id: string) => api.post(`/reports/${id}/run`).then((r) => ({ id, res: r })),
    onSuccess: ({ id, res }) => {
      const total = (res.data as any)?.data?.total ?? 0;
      toast.success(`Report ran — ${total} rows`);
      // Navigate to the detail page so the user actually sees the result —
      // the toast alone was misleading ("Run" appeared to do nothing).
      router.push(`/reports/${id}`);
    },
    onError: () => toast.error('Failed to run'),
  });

  const archiveMut = useMutation({
    mutationFn: (id: string) => api.post(`/reports/${id}/archive`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports'] });
      void qc.invalidateQueries({ queryKey: ['report-stats'] });
      toast.success('Archived');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/reports/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports'] });
      void qc.invalidateQueries({ queryKey: ['report-stats'] });
      toast.success('Deleted');
    },
  });

  const bulkArchiveMut = useMutation({
    mutationFn: (ids: string[]) => api.post('/reports/bulk/archive', { ids }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports'] });
      void qc.invalidateQueries({ queryKey: ['report-stats'] });
      setSelected(new Set()); toast.success('Bulk archive done');
    },
  });

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) => api.post('/reports/bulk/delete', { ids }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports'] });
      void qc.invalidateQueries({ queryKey: ['report-stats'] });
      setSelected(new Set()); toast.success('Bulk delete done');
    },
  });

  // ── Selection ─────────────────────────────────────────────────────────────────

  const allIds = data?.items.map((r) => r.id) ?? [];
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allIds));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const totalPages = data ? Math.ceil(data.total / 25) : 1;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <span className="text-xs font-semibold text-gray-900 flex items-center gap-1.5">
          <FileBarChart size={13} className="text-gray-800" /> Reports
        </span>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium"
        >
          <Plus size={11} /> New Report
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="px-4 py-3 border-b border-gray-200 bg-white flex gap-3 overflow-x-auto shrink-0">
          <StatCard label="Total"     value={stats.total} />
          <StatCard label="Active"    value={stats.active} />
          <StatCard label="Draft"     value={stats.draft} />
          <StatCard label="Scheduled" value={stats.scheduled} />
        </div>
      )}

      {/* Filter rail */}
      <div className="px-4 py-2.5 border-b border-gray-200 bg-white flex items-center gap-2 shrink-0 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-[240px]">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search reports..."
            className="w-full pl-7 pr-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-gray-300" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
              <X size={11} />
            </button>
          )}
        </div>

        <select value={statusFilter} onChange={(e) => { setStatus(e.target.value as ReportStatus | ''); setPage(1); }}
          className="border border-gray-200 rounded px-2 py-1.5 text-xs text-gray-600 focus:outline-none">
          <option value="">All Statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
        </select>

        <select value={typeFilter} onChange={(e) => { setType(e.target.value as ReportType | ''); setPage(1); }}
          className="border border-gray-200 rounded px-2 py-1.5 text-xs text-gray-600 focus:outline-none">
          <option value="">All Types</option>
          {(['TABLE', 'CHART', 'FUNNEL', 'METRIC', 'COHORT'] as ReportType[]).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <select value={entityFilter} onChange={(e) => { setEntity(e.target.value); setPage(1); }}
          className="border border-gray-200 rounded px-2 py-1.5 text-xs text-gray-600 focus:outline-none">
          <option value="">All Entities</option>
          {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>

        <select value={sort} onChange={(e) => { setSort(e.target.value as 'recent' | 'name'); setPage(1); }}
          className="border border-gray-200 rounded px-2 py-1.5 text-xs text-gray-600 focus:outline-none">
          <option value="recent">Sort: Recent</option>
          <option value="name">Sort: Name</option>
        </select>
      </div>

      {/* Bulk toolbar */}
      {selected.size > 0 && (
        <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-medium text-gray-900">{selected.size} selected</span>
          <button onClick={() => bulkArchiveMut.mutate(Array.from(selected))}
            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded bg-gray-500 text-white hover:bg-gray-600">
            <Archive size={10} /> Archive
          </button>
          <button onClick={() => { if (confirm(`Delete ${selected.size}?`)) bulkDeleteMut.mutate(Array.from(selected)); }}
            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded bg-red-500 text-white hover:bg-red-600">
            <Trash2 size={10} /> Delete
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-[11px] text-gray-800 hover:underline">Clear</button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-8 text-center text-gray-300 text-xs">Loading...</div>
        ) : !data?.items.length ? (
          <div className="p-12 text-center">
            <FileBarChart size={28} className="mx-auto mb-2 text-gray-200" />
            <p className="text-xs text-gray-400">No reports found</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200 sticky top-0">
              <tr>
                <th className="w-8 px-3 py-2">
                  <button onClick={toggleAll} className="text-gray-400 hover:text-gray-600">
                    {allSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                  </button>
                </th>
                {['Name', 'Entity', 'Type', 'Status', 'Last Run', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {data.items.map((r) => (
                <tr key={r.id} className={cn('hover:bg-gray-50/60 transition-colors', selected.has(r.id) && 'bg-gray-50/40')}>
                  <td className="px-3 py-2.5">
                    <button onClick={() => toggleOne(r.id)} className="text-gray-400 hover:text-gray-800">
                      {selected.has(r.id) ? <CheckSquare size={13} className="text-gray-800" /> : <Square size={13} />}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/reports/${r.id}`} className="text-xs font-medium text-gray-900 hover:text-gray-900">
                      {r.name}
                    </Link>
                    {r.description && (
                      <p className="text-[10px] text-gray-400 truncate max-w-[180px]">{r.description}</p>
                    )}
                    {r.tags.length > 0 && (
                      <div className="flex gap-1 mt-0.5">
                        {r.tags.slice(0, 2).map((t) => (
                          <span key={t} className="text-[9px] px-1 py-0.5 rounded bg-gray-50 text-gray-800">{t}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-500 capitalize">{r.entity}</td>
                  <td className="px-3 py-2.5">
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', TYPE_COLORS[r.type])}>{r.type}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', STATUS_COLORS[r.status])}>{r.status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-400">
                    {r.lastRunAt ? (
                      <span className="flex items-center gap-1"><Clock size={9} /> {new Date(r.lastRunAt).toLocaleDateString()}</span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => runMut.mutate(r.id)} title="Run"
                        className="p-1 rounded hover:bg-gray-50 text-gray-400 hover:text-gray-800">
                        <Play size={11} />
                      </button>
                      <button onClick={() => archiveMut.mutate(r.id)} title="Archive"
                        className="p-1 rounded hover:bg-gray-100 text-gray-300 hover:text-gray-500">
                        <Archive size={11} />
                      </button>
                      <button onClick={() => { if (confirm('Delete?')) deleteMut.mutate(r.id); }} title="Delete"
                        className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400">
                        <Trash2 size={11} />
                      </button>
                      <Link href={`/reports/${r.id}`} className="p-1 rounded hover:bg-gray-50 text-gray-300 hover:text-gray-800">
                        <MoreHorizontal size={11} />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="h-9 border-t border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <span className="text-[10px] text-gray-400">{data?.total ?? 0} reports</span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
              className="text-[11px] px-2 py-0.5 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50">Prev</button>
            <span className="text-[10px] text-gray-400">{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
              className="text-[11px] px-2 py-0.5 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50">Next</button>
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">New Report</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-gray-600 block mb-1">Name *</label>
                <input value={newName} onChange={(e) => setNewName(e.target.value)}
                  placeholder="Report name"
                  className="w-full border border-gray-200 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-medium text-gray-600 block mb-1">Entity *</label>
                  <select value={newEntity} onChange={(e) => setNewEntity(e.target.value)}
                    className="w-full border border-gray-200 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400">
                    {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-gray-600 block mb-1">Type</label>
                  <select value={newType} onChange={(e) => setNewType(e.target.value as ReportType)}
                    className="w-full border border-gray-200 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400">
                    {(['TABLE', 'CHART', 'FUNNEL', 'METRIC', 'COHORT'] as ReportType[]).map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-600 block mb-1">Description</label>
                <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={2}
                  className="w-full border border-gray-200 rounded px-3 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-gray-400" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => createMut.mutate()}
                disabled={!newName.trim() || createMut.isPending}
                className="flex-1 bg-gray-900 hover:bg-gray-800 text-white py-1.5 rounded text-xs font-medium disabled:opacity-40">
                {createMut.isPending ? 'Creating...' : 'Create Report'}
              </button>
              <button onClick={() => setShowCreate(false)}
                className="px-4 py-1.5 rounded border border-gray-200 text-xs text-gray-500 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
