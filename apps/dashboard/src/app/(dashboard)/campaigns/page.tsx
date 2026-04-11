'use client';

/**
 * Campaigns list — filter rail + stats strip + bulk-select toolbar + table
 * view with inline create modal. Matches the visual language of /leads and
 * /deals so the UI feels uniform across top-level entities.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { formatRelativeTime, cn } from '@/lib/utils';
import {
  Megaphone,
  Plus,
  Search,
  X,
  Trash2,
  Play,
  Pause,
  XCircle,
  Rocket,
  Calendar,
} from 'lucide-react';
import { toast } from 'sonner';

type CampaignStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'SENDING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

type CampaignChannel = 'WHATSAPP' | 'EMAIL' | 'SMS';
type CampaignSendMode = 'DIRECT' | 'BROADCAST' | 'SEQUENCE';

interface Campaign {
  id: string;
  name: string;
  description?: string | null;
  channel: CampaignChannel;
  sendMode: CampaignSendMode;
  status: CampaignStatus;
  templateId?: string | null;
  sequenceId?: string | null;
  startAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  audienceTags: string[];
  audienceContactIds: string[];
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  repliedCount: number;
  failedCount: number;
  tags: string[];
  priority: string;
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  rangeDays: number;
  totalCampaigns: number;
  activeCampaigns: number;
  scheduledCampaigns: number;
  completedCampaigns: number;
  totalSent: number;
  totalReplied: number;
  replyRate: number | null;
  deliveryRate: number | null;
}

const STATUS_COLORS: Record<CampaignStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-500',
  SCHEDULED: 'bg-blue-50 text-blue-600',
  SENDING: 'bg-emerald-50 text-emerald-700',
  PAUSED: 'bg-amber-50 text-amber-600',
  COMPLETED: 'bg-violet-50 text-violet-700',
  CANCELLED: 'bg-gray-50 text-gray-400',
  FAILED: 'bg-red-50 text-red-600',
};

const ALL_STATUSES: CampaignStatus[] = [
  'DRAFT',
  'SCHEDULED',
  'SENDING',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
];

export default function CampaignsPage() {
  const qc = useQueryClient();
  const [selectedStatuses, setSelectedStatuses] = useState<Set<CampaignStatus>>(new Set());
  const [selectedChannel, setSelectedChannel] = useState<CampaignChannel | ''>('');
  const [selectedSendMode, setSelectedSendMode] = useState<CampaignSendMode | ''>('');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);

  // Stats
  const { data: stats } = useQuery({
    queryKey: ['campaign-stats'],
    queryFn: async () => {
      const r = await api.get<{ data: Stats }>('/campaigns/stats');
      return r.data.data;
    },
  });

  // List
  const queryKey = useMemo(
    () => ['campaigns', [...selectedStatuses].join(','), selectedChannel, selectedSendMode, search],
    [selectedStatuses, selectedChannel, selectedSendMode, search],
  );
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedStatuses.size > 0) params.set('status', [...selectedStatuses].join(','));
      if (selectedChannel) params.set('channel', selectedChannel);
      if (selectedSendMode) params.set('sendMode', selectedSendMode);
      if (search) params.set('search', search);
      params.set('limit', '100');
      const r = await api.get<{ data: { items: Campaign[]; total: number } }>(
        `/campaigns?${params.toString()}`,
      );
      return r.data.data;
    },
  });

  // Mutations — inlined (can't call useMutation from a helper factory without violating rules-of-hooks).
  const invalidateAfterBulk = () => {
    void qc.invalidateQueries({ queryKey: ['campaigns'] });
    void qc.invalidateQueries({ queryKey: ['campaign-stats'] });
    setSelectedIds(new Set());
  };
  const bulkPause = useMutation({
    mutationFn: () => api.post('/campaigns/bulk/pause', { ids: [...selectedIds] }),
    onSuccess: () => {
      invalidateAfterBulk();
      toast.success('Bulk pause complete');
    },
    onError: () => toast.error('Bulk pause failed'),
  });
  const bulkResume = useMutation({
    mutationFn: () => api.post('/campaigns/bulk/resume', { ids: [...selectedIds] }),
    onSuccess: () => {
      invalidateAfterBulk();
      toast.success('Bulk resume complete');
    },
    onError: () => toast.error('Bulk resume failed'),
  });
  const bulkCancel = useMutation({
    mutationFn: () => api.post('/campaigns/bulk/cancel', { ids: [...selectedIds] }),
    onSuccess: () => {
      invalidateAfterBulk();
      toast.success('Bulk cancel complete');
    },
    onError: () => toast.error('Bulk cancel failed'),
  });
  const bulkDelete = useMutation({
    mutationFn: () => api.post('/campaigns/bulk/delete', { ids: [...selectedIds] }),
    onSuccess: () => {
      invalidateAfterBulk();
      toast.success('Bulk delete complete');
    },
    onError: () => toast.error('Bulk delete failed'),
  });

  const launchMutation = useMutation({
    mutationFn: (id: string) => api.post(`/campaigns/${id}/launch`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Launched');
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      toast.error(msg ?? 'Launch failed');
    },
  });
  const pauseMutation = useMutation({
    mutationFn: (id: string) => api.post(`/campaigns/${id}/pause`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Paused');
    },
  });

  const toggleStatus = (s: CampaignStatus) => {
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
  const allSelected = items.length > 0 && items.every((c) => selectedIds.has(c.id));

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2">
          <Megaphone size={14} className="text-violet-500" />
          <span className="text-xs font-semibold text-gray-900">Campaigns</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search campaigns..."
              className="w-52 pl-6 pr-2 py-1 text-[11px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium"
          >
            <Plus size={11} /> New Campaign
          </button>
        </div>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="grid grid-cols-5 gap-2 border-b border-gray-200 bg-white px-4 py-2.5 shrink-0">
          <StatTile label="Total" value={stats.totalCampaigns} />
          <StatTile label="Active" value={stats.activeCampaigns} tint="emerald" />
          <StatTile label="Scheduled" value={stats.scheduledCampaigns} tint="blue" />
          <StatTile label="Sent (30d)" value={stats.totalSent} />
          <StatTile
            label="Reply rate"
            value={stats.replyRate !== null ? `${stats.replyRate}%` : '—'}
            tint="violet"
          />
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Filter rail */}
        <aside className="w-52 border-r border-gray-200 bg-white overflow-auto shrink-0 p-3 space-y-4">
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

          <div>
            <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-1.5 font-medium">
              Channel
            </p>
            <select
              value={selectedChannel}
              onChange={(e) => setSelectedChannel(e.target.value as CampaignChannel | '')}
              className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]"
            >
              <option value="">All</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS</option>
            </select>
          </div>

          <div>
            <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-1.5 font-medium">
              Send mode
            </p>
            <select
              value={selectedSendMode}
              onChange={(e) => setSelectedSendMode(e.target.value as CampaignSendMode | '')}
              className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]"
            >
              <option value="">All</option>
              <option value="DIRECT">Direct</option>
              <option value="BROADCAST">Broadcast</option>
              <option value="SEQUENCE">Sequence</option>
            </select>
          </div>

          {(selectedStatuses.size > 0 || selectedChannel || selectedSendMode || search) && (
            <button
              onClick={() => {
                setSelectedStatuses(new Set());
                setSelectedChannel('');
                setSelectedSendMode('');
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
                onClick={() => bulkPause.mutate()}
                className="flex items-center gap-1 text-[11px] text-gray-700 hover:text-gray-900 px-2 py-1 rounded hover:bg-white"
              >
                <Pause size={11} /> Pause
              </button>
              <button
                onClick={() => bulkResume.mutate()}
                className="flex items-center gap-1 text-[11px] text-gray-700 hover:text-gray-900 px-2 py-1 rounded hover:bg-white"
              >
                <Play size={11} /> Resume
              </button>
              <button
                onClick={() => bulkCancel.mutate()}
                className="flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-800 px-2 py-1 rounded hover:bg-white"
              >
                <XCircle size={11} /> Cancel
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete ${selectedIds.size} campaign(s)?`)) bulkDelete.mutate();
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
                <Megaphone size={28} className="mx-auto mb-2 text-gray-200" />
                <p className="text-xs">No campaigns match.</p>
                <p className="text-[10px] mt-1">
                  Click <strong>New Campaign</strong> to create one.
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
                          if (e.target.checked) setSelectedIds(new Set(items.map((c) => c.id)));
                          else setSelectedIds(new Set());
                        }}
                        className="accent-violet-500 w-3 h-3"
                      />
                    </th>
                    {['Name', 'Status', 'Channel', 'Mode', 'Progress', 'Replies', 'Schedule', 'Updated', ''].map(
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
                  {items.map((c) => {
                    const progress =
                      c.totalRecipients > 0
                        ? Math.round(((c.sentCount + c.failedCount) / c.totalRecipients) * 100)
                        : 0;
                    return (
                      <tr key={c.id} className="hover:bg-gray-50/50">
                        <td className="px-2 py-2 w-8">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(c.id)}
                            onChange={() => toggleSelect(c.id)}
                            className="accent-violet-500 w-3 h-3"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Link
                            href={`/campaigns/${c.id}`}
                            className="text-xs font-medium text-gray-900 hover:text-violet-600"
                          >
                            {c.name}
                          </Link>
                          {c.description && (
                            <div className="text-[10px] text-gray-400 truncate max-w-xs">
                              {c.description}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <span
                            className={cn(
                              'text-[9px] px-1.5 py-0.5 rounded font-medium',
                              STATUS_COLORS[c.status],
                            )}
                          >
                            {c.status}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-[10px] text-gray-500">{c.channel}</td>
                        <td className="px-2 py-2 text-[10px] text-gray-500">{c.sendMode}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5">
                            <div className="w-16 h-1 bg-gray-100 rounded overflow-hidden">
                              <div
                                className={cn(
                                  'h-full rounded transition-all',
                                  c.status === 'FAILED' ? 'bg-red-400' : 'bg-violet-500',
                                )}
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-gray-500 tabular-nums">
                              {c.sentCount}/{c.totalRecipients}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-[10px] text-gray-500 tabular-nums">
                          {c.repliedCount}
                        </td>
                        <td className="px-2 py-2 text-[10px] text-gray-400">
                          {c.startAt ? (
                            <span className="flex items-center gap-1">
                              <Calendar size={9} />
                              {new Date(c.startAt).toLocaleString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-2 py-2 text-[10px] text-gray-400">
                          {formatRelativeTime(c.updatedAt)}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1">
                            {c.status === 'DRAFT' || c.status === 'SCHEDULED' ? (
                              <button
                                onClick={() => launchMutation.mutate(c.id)}
                                title="Launch now"
                                className="text-emerald-600 hover:text-emerald-700 p-0.5"
                              >
                                <Rocket size={11} />
                              </button>
                            ) : null}
                            {c.status === 'SENDING' ? (
                              <button
                                onClick={() => pauseMutation.mutate(c.id)}
                                title="Pause"
                                className="text-amber-600 hover:text-amber-700 p-0.5"
                              >
                                <Pause size={11} />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer */}
          <div className="h-8 border-t border-gray-200 px-3 flex items-center shrink-0 bg-white">
            <span className="text-[10px] text-gray-400">
              {items.length} of {total} campaign{total === 1 ? '' : 's'}
            </span>
          </div>
        </main>
      </div>

      {showCreate && (
        <CreateCampaignModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['campaigns'] });
            void qc.invalidateQueries({ queryKey: ['campaign-stats'] });
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

function CreateCampaignModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<CampaignChannel>('WHATSAPP');
  const [sendMode, setSendMode] = useState<CampaignSendMode>('DIRECT');
  const [templateId, setTemplateId] = useState('');
  const [sequenceId, setSequenceId] = useState('');
  const [audienceTags, setAudienceTags] = useState('');

  const { data: templates } = useQuery({
    queryKey: ['templates-picker'],
    queryFn: async () => {
      const r = await api.get<{ data: { items: Array<{ id: string; name: string; status: string }> } }>(
        '/templates?status=ACTIVE&limit=100',
      );
      return r.data.data.items;
    },
    enabled: sendMode === 'DIRECT',
  });

  const { data: sequences } = useQuery({
    queryKey: ['sequences-picker'],
    queryFn: async () => {
      const r = await api.get<{ data: { items: Array<{ id: string; name: string; status: string }> } }>(
        '/sequences?status=ACTIVE&limit=100',
      );
      return r.data.data.items;
    },
    enabled: sendMode === 'SEQUENCE',
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/campaigns', {
        name,
        channel,
        sendMode,
        templateId: sendMode === 'DIRECT' && templateId ? templateId : undefined,
        sequenceId: sendMode === 'SEQUENCE' && sequenceId ? sequenceId : undefined,
        audience: {
          tags: audienceTags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          contactIds: [],
          optOutBehavior: 'skip',
        },
      }),
    onSuccess: () => {
      toast.success('Campaign created in DRAFT');
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

  const canCreate =
    name.trim().length > 0 &&
    (sendMode !== 'DIRECT' || templateId) &&
    (sendMode !== 'SEQUENCE' || sequenceId);

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[480px] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold">New Campaign</h3>
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

        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] text-gray-500">
            <span className="block uppercase tracking-widest mb-0.5">Channel</span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as CampaignChannel)}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs"
            >
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL" disabled>
                Email (coming soon)
              </option>
              <option value="SMS" disabled>
                SMS (coming soon)
              </option>
            </select>
          </label>
          <label className="text-[10px] text-gray-500">
            <span className="block uppercase tracking-widest mb-0.5">Send mode</span>
            <select
              value={sendMode}
              onChange={(e) => setSendMode(e.target.value as CampaignSendMode)}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs"
            >
              <option value="DIRECT">Direct (template)</option>
              <option value="BROADCAST">Broadcast</option>
              <option value="SEQUENCE">Sequence</option>
            </select>
          </label>
        </div>

        {sendMode === 'DIRECT' && (
          <label className="text-[10px] text-gray-500 block">
            <span className="block uppercase tracking-widest mb-0.5">Template (required)</span>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs"
            >
              <option value="">Select template...</option>
              {templates?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {sendMode === 'SEQUENCE' && (
          <label className="text-[10px] text-gray-500 block">
            <span className="block uppercase tracking-widest mb-0.5">Sequence (required)</span>
            <select
              value={sequenceId}
              onChange={(e) => setSequenceId(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs"
            >
              <option value="">Select sequence...</option>
              {sequences?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="text-[10px] text-gray-500 block">
          <span className="block uppercase tracking-widest mb-0.5">Audience tags (comma-separated)</span>
          <input
            value={audienceTags}
            onChange={(e) => setAudienceTags(e.target.value)}
            placeholder="vip, diwali, newsletter"
            className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
          />
          <span className="text-[9px] text-gray-400 mt-0.5 block">
            AND-joined. You can refine the audience from the detail page after creating.
          </span>
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-gray-500 text-[11px] px-2 py-1">
            Cancel
          </button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!canCreate || createMutation.isPending}
            className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30"
          >
            {createMutation.isPending ? 'Creating…' : 'Create as Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}
