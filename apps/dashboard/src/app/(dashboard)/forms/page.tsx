'use client';

/**
 * Forms list — filter rail + stats strip + bulk-select toolbar + table
 * view with inline create modal. Matches /leads, /deals, /campaigns.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { formatRelativeTime, cn } from '@/lib/utils';
import {
  ClipboardList,
  Plus,
  Search,
  X,
  Trash2,
  Rocket,
  Pause,
  Archive,
} from 'lucide-react';
import { toast } from 'sonner';

type FormStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

interface FormRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: FormStatus;
  fields: unknown[];
  isPublic: boolean;
  submitCount: number;
  convertedCount: number;
  spamCount: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  rangeDays: number;
  totalForms: number;
  activeForms: number;
  totalSubmissions: number;
  totalConverted: number;
  conversionRate: number | null;
  spamRate: number | null;
}

const STATUS_COLORS: Record<FormStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-500',
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  PAUSED: 'bg-amber-50 text-amber-600',
  ARCHIVED: 'bg-gray-50 text-gray-400',
};

const ALL_STATUSES: FormStatus[] = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'];

export default function FormsPage() {
  const qc = useQueryClient();
  const [selectedStatuses, setSelectedStatuses] = useState<Set<FormStatus>>(new Set());
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);

  const { data: stats } = useQuery({
    queryKey: ['form-stats'],
    queryFn: async () => {
      const r = await api.get<{ data: Stats }>('/forms/stats');
      return r.data.data;
    },
  });

  const queryKey = useMemo(
    () => ['forms', [...selectedStatuses].join(','), search],
    [selectedStatuses, search],
  );
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedStatuses.size > 0) params.set('status', [...selectedStatuses].join(','));
      if (search) params.set('search', search);
      params.set('limit', '100');
      const r = await api.get<{ data: { items: FormRow[]; total: number } }>(
        `/forms?${params.toString()}`,
      );
      return r.data.data;
    },
  });

  // Mutations — inlined to avoid rules-of-hooks violations
  const invalidateAfterBulk = () => {
    void qc.invalidateQueries({ queryKey: ['forms'] });
    void qc.invalidateQueries({ queryKey: ['form-stats'] });
    setSelectedIds(new Set());
  };
  const bulkPublish = useMutation({
    mutationFn: () => api.post('/forms/bulk/publish', { ids: [...selectedIds] }),
    onSuccess: () => {
      invalidateAfterBulk();
      toast.success('Bulk publish complete');
    },
    onError: () => toast.error('Bulk publish failed'),
  });
  const bulkUnpublish = useMutation({
    mutationFn: () => api.post('/forms/bulk/unpublish', { ids: [...selectedIds] }),
    onSuccess: () => {
      invalidateAfterBulk();
      toast.success('Bulk unpublish complete');
    },
    onError: () => toast.error('Bulk unpublish failed'),
  });
  const bulkArchive = useMutation({
    mutationFn: () => api.post('/forms/bulk/archive', { ids: [...selectedIds] }),
    onSuccess: () => {
      invalidateAfterBulk();
      toast.success('Bulk archive complete');
    },
    onError: () => toast.error('Bulk archive failed'),
  });
  const bulkDelete = useMutation({
    mutationFn: () => api.post('/forms/bulk/delete', { ids: [...selectedIds] }),
    onSuccess: () => {
      invalidateAfterBulk();
      toast.success('Bulk delete complete');
    },
    onError: () => toast.error('Bulk delete failed'),
  });

  const publishMutation = useMutation({
    mutationFn: (id: string) => api.post(`/forms/${id}/publish`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['forms'] });
      toast.success('Published');
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      toast.error(msg ?? 'Publish failed');
    },
  });

  const toggleStatus = (s: FormStatus) => {
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
  const allSelected = items.length > 0 && items.every((f) => selectedIds.has(f.id));

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2">
          <ClipboardList size={14} className="text-violet-500" />
          <span className="text-xs font-semibold text-gray-900">Forms</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search forms..."
              className="w-52 pl-6 pr-2 py-1 text-[11px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium"
          >
            <Plus size={11} /> New Form
          </button>
        </div>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="grid grid-cols-5 gap-2 border-b border-gray-200 bg-white px-4 py-2.5 shrink-0">
          <StatTile label="Total" value={stats.totalForms} />
          <StatTile label="Active" value={stats.activeForms} tint="emerald" />
          <StatTile label="Submissions" value={stats.totalSubmissions} />
          <StatTile label="Converted" value={stats.totalConverted} tint="violet" />
          <StatTile
            label="Conv rate"
            value={stats.conversionRate !== null ? `${stats.conversionRate}%` : '—'}
            tint="violet"
          />
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Filter rail */}
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

        {/* Main area */}
        <main className="flex-1 flex flex-col min-w-0 bg-white">
          {/* Bulk toolbar */}
          {selectedIds.size > 0 && (
            <div className="h-9 border-b border-gray-200 px-3 flex items-center gap-3 shrink-0 bg-violet-50">
              <span className="text-[11px] text-violet-700 font-medium">
                {selectedIds.size} selected
              </span>
              <div className="flex-1" />
              <button
                onClick={() => bulkPublish.mutate()}
                className="flex items-center gap-1 text-[11px] text-gray-700 hover:text-gray-900 px-2 py-1 rounded hover:bg-white"
              >
                <Rocket size={11} /> Publish
              </button>
              <button
                onClick={() => bulkUnpublish.mutate()}
                className="flex items-center gap-1 text-[11px] text-gray-700 hover:text-gray-900 px-2 py-1 rounded hover:bg-white"
              >
                <Pause size={11} /> Unpublish
              </button>
              <button
                onClick={() => bulkArchive.mutate()}
                className="flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-800 px-2 py-1 rounded hover:bg-white"
              >
                <Archive size={11} /> Archive
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete ${selectedIds.size} form(s)?`)) bulkDelete.mutate();
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

          {/* Table */}
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="p-8 text-center text-gray-300 text-xs">Loading...</div>
            ) : items.length === 0 ? (
              <div className="p-12 text-center text-gray-300">
                <ClipboardList size={28} className="mx-auto mb-2 text-gray-200" />
                <p className="text-xs">No forms match.</p>
                <p className="text-[10px] mt-1">
                  Click <strong>New Form</strong> to create one.
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
                          if (e.target.checked) setSelectedIds(new Set(items.map((f) => f.id)));
                          else setSelectedIds(new Set());
                        }}
                        className="accent-violet-500 w-3 h-3"
                      />
                    </th>
                    {['Name', 'Status', 'Public', 'Fields', 'Submissions', 'Conversion', 'Updated', ''].map(
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
                  {items.map((f) => {
                    const conv =
                      f.submitCount > 0 ? Math.round((f.convertedCount / f.submitCount) * 100) : 0;
                    return (
                      <tr key={f.id} className="hover:bg-gray-50/50">
                        <td className="px-2 py-2 w-8">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(f.id)}
                            onChange={() => toggleSelect(f.id)}
                            className="accent-violet-500 w-3 h-3"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Link
                            href={`/forms/${f.id}`}
                            className="text-xs font-medium text-gray-900 hover:text-violet-600"
                          >
                            {f.name}
                          </Link>
                          <div className="text-[10px] text-gray-400 truncate max-w-xs">
                            /{f.slug}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <span
                            className={cn(
                              'text-[9px] px-1.5 py-0.5 rounded font-medium',
                              STATUS_COLORS[f.status],
                            )}
                          >
                            {f.status}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-[10px] text-gray-500">
                          {f.isPublic ? (
                            <span className="text-emerald-600">●</span>
                          ) : (
                            <span className="text-gray-300">○</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-[10px] text-gray-500">
                          {f.fields.length}
                        </td>
                        <td className="px-2 py-2 text-[10px] text-gray-500 tabular-nums">
                          {f.submitCount}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5">
                            <div className="w-14 h-1 bg-gray-100 rounded overflow-hidden">
                              <div
                                className="h-full bg-violet-500 rounded"
                                style={{ width: `${conv}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-gray-500 tabular-nums">
                              {f.convertedCount}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-[10px] text-gray-400">
                          {formatRelativeTime(f.updatedAt)}
                        </td>
                        <td className="px-2 py-2">
                          {(f.status === 'DRAFT' || f.status === 'PAUSED') && (
                            <button
                              onClick={() => publishMutation.mutate(f.id)}
                              title="Publish"
                              className="text-emerald-600 hover:text-emerald-700 p-0.5"
                            >
                              <Rocket size={11} />
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
              {items.length} of {total} form{total === 1 ? '' : 's'}
            </span>
          </div>
        </main>
      </div>

      {showCreate && (
        <CreateFormModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['forms'] });
            void qc.invalidateQueries({ queryKey: ['form-stats'] });
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
  tint?: 'emerald' | 'blue' | 'violet';
}) {
  const tints: Record<string, string> = {
    emerald: 'text-emerald-600',
    blue: 'text-blue-600',
    violet: 'text-violet-600',
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

function CreateFormModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/forms', { name, description: description || undefined }),
    onSuccess: () => {
      toast.success('Form created in DRAFT');
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
      <div className="bg-white rounded-lg shadow-xl w-[440px] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold">New Form</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (required)"
          className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
          autoFocus
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          rows={2}
          className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
        />
        <p className="text-[10px] text-gray-400">
          You&apos;ll add fields + configure auto-actions on the detail page after creating.
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-gray-500 text-[11px] px-2 py-1">
            Cancel
          </button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || createMutation.isPending}
            className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30"
          >
            {createMutation.isPending ? 'Creating…' : 'Create as Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}
