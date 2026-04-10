'use client';

/**
 * Broadcasts list page — filter rail + 5-tile stats strip + bulk-select
 * toolbar + click-through to detail. Mirrors the leads/deals/tasks/products
 * pattern. Status badges show the new BroadcastStatus enum (DRAFT,
 * SCHEDULED, SENDING, COMPLETED, CANCELLED, PAUSED, FAILED).
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { cn, formatRelativeTime } from '@/lib/utils';
import {
  Plus, Search, X, Trash2, Megaphone, Clock, CheckCircle, Loader2, Pause,
  AlertCircle, TrendingUp, Send,
} from 'lucide-react';
import { toast } from 'sonner';

export interface Broadcast {
  id: string;
  name: string;
  message: string;
  status: BroadcastStatus;
  mediaUrl?: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  deliveredCount: number;
  readCount: number;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type BroadcastStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'SENDING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'PAUSED'
  | 'FAILED';

interface Stats {
  rangeDays: number;
  byStatus: Record<string, number>;
  sent: number;
  failed: number;
  delivered: number;
  read: number;
  total: number;
  deliveryRate: number;
  openRate: number;
}

const STATUSES: BroadcastStatus[] = ['DRAFT', 'SCHEDULED', 'SENDING', 'COMPLETED', 'CANCELLED', 'PAUSED', 'FAILED'];

export const STATUS_COLORS: Record<BroadcastStatus, string> = {
  DRAFT: 'bg-gray-50 text-gray-600 border-gray-100',
  SCHEDULED: 'bg-amber-50 text-amber-700 border-amber-100',
  SENDING: 'bg-blue-50 text-blue-700 border-blue-100',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  CANCELLED: 'bg-red-50 text-red-500 border-red-100',
  PAUSED: 'bg-orange-50 text-orange-700 border-orange-100',
  FAILED: 'bg-red-50 text-red-700 border-red-100',
};

function StatusBadge({ status }: { status: BroadcastStatus }) {
  const Icon =
    status === 'COMPLETED' ? CheckCircle :
    status === 'SENDING' ? Loader2 :
    status === 'SCHEDULED' ? Clock :
    status === 'PAUSED' ? Pause :
    status === 'FAILED' ? AlertCircle :
    null;
  return (
    <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium flex items-center gap-1', STATUS_COLORS[status])}>
      {Icon && <Icon size={9} className={status === 'SENDING' ? 'animate-spin' : ''} />}
      {status}
    </span>
  );
}

export default function BroadcastsPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<BroadcastStatus | ''>('');
  const [sort, setSort] = useState<'recent' | 'scheduled' | 'sent_count' | 'name'>('recent');
  const [showCreate, setShowCreate] = useState(false);

  useMemo(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ['broadcasts', { filterStatus, debouncedSearch, sort }],
    queryFn: async () => {
      const res = await api.get<{ data: { items: Broadcast[]; total: number } }>('/broadcasts', {
        params: {
          status: filterStatus || undefined,
          search: debouncedSearch || undefined,
          sort,
          limit: 200,
        },
      });
      return res.data.data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['broadcast-stats'],
    queryFn: async () => {
      const r = await api.get<{ data: Stats }>('/broadcasts/stats', { params: { days: 30 } });
      return r.data.data;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/broadcasts/${id}/cancel`),
    onSuccess: () => toast.success('Cancelled'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/broadcasts/${id}`),
    onSuccess: () => toast.success('Deleted'),
  });

  const items = data?.items ?? [];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-3">
          <Megaphone size={14} className="text-violet-500" />
          <span className="text-xs font-semibold text-gray-900">Broadcasts</span>
          {data && <span className="text-[10px] text-gray-400">{data.total} total</span>}
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium">
          <Plus size={11} /> New Broadcast
        </button>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="px-4 py-2 border-b border-gray-100 bg-white shrink-0 grid grid-cols-5 gap-3">
          <StatTile icon={<TrendingUp size={12} />} label="Sent (30d)" value={String(stats.sent)} accent="text-violet-600" />
          <StatTile icon={<CheckCircle size={12} />} label="Delivered" value={String(stats.delivered)} accent="text-emerald-600" />
          <StatTile icon={<Send size={12} />} label="Delivery rate" value={`${stats.deliveryRate}%`} accent="text-blue-600" />
          <StatTile icon={<TrendingUp size={12} />} label="Open rate" value={`${stats.openRate}%`} accent="text-orange-600" />
          <StatTile icon={<AlertCircle size={12} />} label="Failed" value={String(stats.failed)} accent={stats.failed > 0 ? 'text-red-600' : 'text-gray-500'} />
        </div>
      )}

      {/* Filter rail */}
      <div className="border-b border-gray-100 bg-white shrink-0 px-3 py-2 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 border border-gray-200 rounded px-2 flex-1 max-w-xs">
          <Search size={11} className="text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or message…" className="text-[11px] py-1 w-full focus:outline-none" />
        </div>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as BroadcastStatus | '')} className="text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as never)} className="text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white">
          <option value="recent">Sort: Recent</option>
          <option value="scheduled">Sort: Scheduled</option>
          <option value="sent_count">Sort: Sent count</option>
          <option value="name">Sort: Name</option>
        </select>
        {(filterStatus || debouncedSearch) && (
          <button onClick={() => { setFilterStatus(''); setSearch(''); }} className="text-[10px] text-gray-400 hover:text-gray-700 flex items-center gap-1">
            <X size={10} /> Clear
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto bg-white">
        {isLoading ? (
          <div className="p-8 text-center text-gray-300 text-xs">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center">
            <Megaphone size={32} className="mx-auto text-gray-200 mb-2" />
            <p className="text-xs text-gray-300 mb-2">No broadcasts yet.</p>
            <button onClick={() => setShowCreate(true)} className="text-[11px] text-violet-600 hover:text-violet-700">+ New Broadcast</button>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((b) => {
              const progress = b.totalRecipients > 0 ? Math.round((b.sentCount / b.totalRecipients) * 100) : 0;
              return (
                <div key={b.id} className="px-3 py-2.5 hover:bg-gray-50/50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Link href={`/broadcasts/${b.id}`} className="text-xs font-medium text-gray-900 hover:text-violet-600">
                          {b.name}
                        </Link>
                        <StatusBadge status={b.status} />
                      </div>
                      <p className="text-[11px] text-gray-400 truncate">{b.message}</p>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500">
                        <span>{b.totalRecipients} recipients</span>
                        {b.sentCount > 0 && <span className="text-emerald-600">{b.sentCount} sent</span>}
                        {b.failedCount > 0 && <span className="text-red-500">{b.failedCount} failed</span>}
                        {b.scheduledAt && b.status === 'SCHEDULED' && (
                          <span className="text-amber-600">scheduled {formatRelativeTime(b.scheduledAt)}</span>
                        )}
                        <span className="text-gray-400">created {formatRelativeTime(b.createdAt)}</span>
                      </div>
                      {b.status === 'SENDING' && b.totalRecipients > 0 && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="flex-1 bg-gray-100 rounded-full h-1 max-w-xs">
                            <div className="bg-violet-500 h-1 rounded-full transition-all" style={{ width: `${progress}%` }} />
                          </div>
                          <span className="text-[10px] text-gray-400">{progress}%</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {(b.status === 'DRAFT' || b.status === 'SCHEDULED') && (
                        <button
                          onClick={() => { if (confirm(`Cancel "${b.name}"?`)) cancelMutation.mutate(b.id); }}
                          className="text-gray-300 hover:text-orange-500 p-1"
                          title="Cancel"
                        >
                          <X size={12} />
                        </button>
                      )}
                      {(b.status === 'DRAFT' || b.status === 'COMPLETED' || b.status === 'CANCELLED' || b.status === 'FAILED') && (
                        <button
                          onClick={() => { if (confirm(`Delete "${b.name}"?`)) deleteMutation.mutate(b.id); }}
                          className="text-gray-300 hover:text-red-500 p-1"
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="h-9 border-t border-gray-200 px-3 flex items-center shrink-0 bg-white">
        <span className="text-[10px] text-gray-400">{data?.total ?? 0} broadcasts</span>
      </div>

      {showCreate && <CreateBroadcastModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

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

function CreateBroadcastModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      // Step 1: create the broadcast
      const created = await api.post<{ data: Broadcast }>('/broadcasts', { name, message });
      const broadcastId = created.data.data.id;
      // Step 2: optionally set audience by tags
      const tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);
      if (tags.length > 0) {
        await api.post(`/broadcasts/${broadcastId}/audience`, { tags });
      }
      return created.data.data;
    },
    onSuccess: (b) => {
      toast.success(`Created "${b.name}" — open it to schedule or send`);
      onClose();
    },
    onError: () => toast.error('Failed to create broadcast'),
  });

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[480px] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold">New Broadcast</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Broadcast name (internal — not shown to recipients)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder="Message body (use {{firstName}}, {{name}}, {{phoneNumber}} for personalization)"
          className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none"
        />
        <input
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          placeholder="Audience tags (comma-separated, optional)"
          className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
        />
        <p className="text-[10px] text-gray-400">
          The broadcast starts in DRAFT. Open it to set audience, schedule, or send.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-gray-500 text-[11px] px-2 py-1">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!name || !message || mutation.isPending}
            className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30"
          >
            {mutation.isPending ? 'Creating…' : 'Create draft'}
          </button>
        </div>
      </div>
    </div>
  );
}
