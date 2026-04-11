'use client';

/**
 * Campaign detail — 3-column Linear layout matching /leads/[id] and /deals/[id].
 *
 * Left panel:  metadata, audience summary, send-mode config, quick edit form
 * Center:      tab switcher — Activity / Recipients / Notes
 * Right:       quick actions (launch/pause/resume/cancel/duplicate/delete)
 *              contextually enabled based on current status.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { cn, formatRelativeTime } from '@/lib/utils';
import {
  ArrowLeft,
  Rocket,
  Pause,
  Play,
  XCircle,
  Copy,
  Trash2,
  Calendar,
  Users,
  Tag,
  Eye,
  Send,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
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

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  channel: 'WHATSAPP' | 'EMAIL' | 'SMS';
  sendMode: 'DIRECT' | 'BROADCAST' | 'SEQUENCE';
  status: CampaignStatus;
  templateId: string | null;
  sequenceId: string | null;
  broadcastId: string | null;
  startAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  cancelledAt: string | null;
  audienceTags: string[];
  audienceContactIds: string[];
  audienceOptOutBehavior: string;
  throttleMs: number;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  repliedCount: number;
  failedCount: number;
  optedOutCount: number;
  tags: string[];
  priority: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  activities?: Array<{
    id: string;
    type: string;
    title: string;
    body: string | null;
    actorType: string;
    createdAt: string;
    metadata: unknown;
  }>;
}

interface RecipientRow {
  id: string;
  contactId: string;
  status: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  repliedAt: string | null;
  failedAt: string | null;
  errorReason: string | null;
}

interface AudiencePreview {
  totalMatch: number;
  optedOut: number;
  netDeliverable: number;
  sampleContacts: Array<{
    id: string;
    displayName?: string | null;
    phoneNumber: string;
  }>;
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

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  CREATED: <FileText size={11} className="text-gray-400" />,
  LAUNCHED: <Rocket size={11} className="text-emerald-500" />,
  SCHEDULED: <Calendar size={11} className="text-blue-500" />,
  PAUSED: <Pause size={11} className="text-amber-500" />,
  RESUMED: <Play size={11} className="text-emerald-500" />,
  CANCELLED: <XCircle size={11} className="text-red-500" />,
  COMPLETED: <CheckCircle2 size={11} className="text-violet-500" />,
  AUDIENCE_UPDATED: <Users size={11} className="text-gray-400" />,
  NOTE_ADDED: <MessageSquare size={11} className="text-gray-400" />,
  FIELD_UPDATED: <FileText size={11} className="text-gray-400" />,
  ERROR: <AlertTriangle size={11} className="text-red-500" />,
  RECIPIENT_SENT: <Send size={11} className="text-gray-400" />,
  RECIPIENT_DELIVERED: <CheckCircle2 size={11} className="text-emerald-400" />,
  RECIPIENT_READ: <Eye size={11} className="text-blue-400" />,
  RECIPIENT_REPLIED: <MessageSquare size={11} className="text-violet-500" />,
  RECIPIENT_FAILED: <AlertTriangle size={11} className="text-red-400" />,
};

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const id = params.id as string;

  const [tab, setTab] = useState<'activity' | 'recipients' | 'notes'>('activity');
  const [recipientStatusFilter, setRecipientStatusFilter] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [preview, setPreview] = useState<AudiencePreview | null>(null);

  const { data: campaign, isLoading } = useQuery({
    queryKey: ['campaign', id],
    queryFn: async () => {
      const r = await api.get<{ data: Campaign }>(`/campaigns/${id}`);
      return r.data.data;
    },
  });

  const { data: recipients } = useQuery({
    queryKey: ['campaign-recipients', id, recipientStatusFilter],
    enabled: tab === 'recipients',
    queryFn: async () => {
      const q = recipientStatusFilter ? `?status=${recipientStatusFilter}` : '';
      const r = await api.get<{ data: { items: RecipientRow[]; total: number } }>(
        `/campaigns/${id}/recipients${q}`,
      );
      return r.data.data;
    },
  });

  // Mutations — inlined (can't call useMutation from a helper factory without violating rules-of-hooks).
  const onMutError = (err: unknown) => {
    const msg =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : null;
    toast.error(msg ?? 'Failed');
  };
  const invalidateCampaign = () => {
    void qc.invalidateQueries({ queryKey: ['campaign', id] });
  };
  const launchM = useMutation({
    mutationFn: () => api.post(`/campaigns/${id}/launch`),
    onSuccess: () => {
      invalidateCampaign();
      toast.success('Launched');
    },
    onError: onMutError,
  });
  const pauseM = useMutation({
    mutationFn: () => api.post(`/campaigns/${id}/pause`),
    onSuccess: () => {
      invalidateCampaign();
      toast.success('Paused');
    },
    onError: onMutError,
  });
  const resumeM = useMutation({
    mutationFn: () => api.post(`/campaigns/${id}/resume`),
    onSuccess: () => {
      invalidateCampaign();
      toast.success('Resumed');
    },
    onError: onMutError,
  });
  const cancelM = useMutation({
    mutationFn: () => api.post(`/campaigns/${id}/cancel`, { reason: 'manual cancel' }),
    onSuccess: () => {
      invalidateCampaign();
      toast.success('Cancelled');
    },
    onError: onMutError,
  });
  const duplicateM = useMutation({
    mutationFn: () => api.post(`/campaigns/${id}/duplicate`),
    onSuccess: (r) => {
      toast.success('Duplicated');
      const newId = (r.data as { data: { id: string } }).data.id;
      router.push(`/campaigns/${newId}`);
    },
  });
  const deleteM = useMutation({
    mutationFn: () => api.delete(`/campaigns/${id}`),
    onSuccess: () => {
      toast.success('Deleted');
      router.push('/campaigns');
    },
    onError: () => toast.error('Delete failed'),
  });

  const previewM = useMutation({
    mutationFn: async () => {
      const r = await api.post<{ data: AudiencePreview }>(`/campaigns/${id}/audience/preview`);
      return r.data.data;
    },
    onSuccess: (p) => {
      setPreview(p);
      toast.success(`${p.netDeliverable} contacts would receive this`);
    },
    onError: () => toast.error('Preview failed'),
  });

  const addNoteM = useMutation({
    mutationFn: () => api.post(`/campaigns/${id}/notes`, { body: noteDraft }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaign', id] });
      setNoteDraft('');
      toast.success('Note added');
    },
  });

  const progress = useMemo(() => {
    if (!campaign || campaign.totalRecipients === 0) return 0;
    return Math.round(
      ((campaign.sentCount + campaign.failedCount) / campaign.totalRecipients) * 100,
    );
  }, [campaign]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-300 text-xs">Loading…</p>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-300 text-xs">Campaign not found</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center gap-3 shrink-0 bg-white">
        <Link href="/campaigns" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={14} />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xs font-semibold text-gray-900 truncate">{campaign.name}</h1>
          {campaign.description && (
            <p className="text-[10px] text-gray-400 truncate">{campaign.description}</p>
          )}
        </div>
        <span className={cn('text-[10px] px-2 py-0.5 rounded font-medium', STATUS_COLORS[campaign.status])}>
          {campaign.status}
        </span>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Left panel */}
        <aside className="w-64 border-r border-gray-200 bg-white overflow-auto shrink-0">
          <div className="p-3 space-y-4">
            <Section title="Channel & Mode">
              <Row label="Channel" value={campaign.channel} />
              <Row label="Send mode" value={campaign.sendMode} />
              {campaign.templateId && (
                <Row label="Template" value={<code className="text-[10px]">{campaign.templateId.slice(0, 10)}…</code>} />
              )}
              {campaign.sequenceId && (
                <Row label="Sequence" value={<code className="text-[10px]">{campaign.sequenceId.slice(0, 10)}…</code>} />
              )}
              <Row label="Throttle" value={`${campaign.throttleMs}ms`} />
            </Section>

            <Section title="Audience">
              {campaign.audienceTags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {campaign.audienceTags.map((t) => (
                    <span
                      key={t}
                      className="text-[9px] bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded flex items-center gap-0.5"
                    >
                      <Tag size={8} /> {t}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-gray-400">No tag filter</p>
              )}
              {campaign.audienceContactIds.length > 0 && (
                <p className="text-[10px] text-gray-500 mt-1">
                  + {campaign.audienceContactIds.length} explicit contacts
                </p>
              )}
              <button
                onClick={() => previewM.mutate()}
                disabled={previewM.isPending}
                className="w-full mt-2 flex items-center justify-center gap-1 text-[10px] bg-gray-50 hover:bg-gray-100 text-gray-700 px-2 py-1 rounded"
              >
                <Eye size={10} /> {previewM.isPending ? 'Resolving…' : 'Preview audience'}
              </button>
              {preview && (
                <div className="mt-2 p-2 bg-gray-50 rounded text-[10px] space-y-0.5">
                  <div>
                    Deliverable: <strong className="text-gray-900">{preview.netDeliverable}</strong>
                  </div>
                  <div className="text-gray-500">
                    Total match: {preview.totalMatch} · Opted out: {preview.optedOut}
                  </div>
                  {preview.sampleContacts.length > 0 && (
                    <div className="mt-1 text-gray-500">
                      Sample:{' '}
                      {preview.sampleContacts
                        .slice(0, 3)
                        .map((c) => c.displayName ?? c.phoneNumber)
                        .join(', ')}
                      {preview.sampleContacts.length > 3 && '…'}
                    </div>
                  )}
                </div>
              )}
            </Section>

            <Section title="Progress">
              <div className="space-y-1.5">
                <div className="h-1.5 bg-gray-100 rounded overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded transition-all',
                      campaign.status === 'FAILED' ? 'bg-red-400' : 'bg-violet-500',
                    )}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  <Row label="Sent" value={campaign.sentCount} compact />
                  <Row label="Failed" value={campaign.failedCount} compact />
                  <Row label="Delivered" value={campaign.deliveredCount} compact />
                  <Row label="Read" value={campaign.readCount} compact />
                  <Row label="Replied" value={campaign.repliedCount} compact />
                  <Row label="Opted out" value={campaign.optedOutCount} compact />
                </div>
              </div>
            </Section>

            <Section title="Schedule">
              {campaign.startAt && (
                <Row
                  label="Scheduled for"
                  value={new Date(campaign.startAt).toLocaleString()}
                />
              )}
              {campaign.startedAt && (
                <Row
                  label="Started"
                  value={new Date(campaign.startedAt).toLocaleString()}
                />
              )}
              {campaign.completedAt && (
                <Row
                  label="Completed"
                  value={new Date(campaign.completedAt).toLocaleString()}
                />
              )}
              {campaign.pausedAt && (
                <Row
                  label="Paused at"
                  value={new Date(campaign.pausedAt).toLocaleString()}
                />
              )}
              {campaign.cancelledAt && (
                <Row
                  label="Cancelled at"
                  value={new Date(campaign.cancelledAt).toLocaleString()}
                />
              )}
            </Section>

            <Section title="Meta">
              <Row label="Priority" value={campaign.priority} />
              {campaign.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {campaign.tags.map((t) => (
                    <span key={t} className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <Row label="Created" value={formatRelativeTime(campaign.createdAt)} />
              <Row label="Updated" value={formatRelativeTime(campaign.updatedAt)} />
            </Section>
          </div>
        </aside>

        {/* Center panel */}
        <main className="flex-1 flex flex-col min-w-0 bg-white">
          {/* Tabs */}
          <div className="h-9 border-b border-gray-200 px-3 flex items-center gap-4 shrink-0">
            {(['activity', 'recipients', 'notes'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'text-[11px] py-1 border-b-2 transition-colors',
                  tab === t
                    ? 'border-violet-500 text-gray-900'
                    : 'border-transparent text-gray-400 hover:text-gray-600',
                )}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {tab === 'activity' && (
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {!campaign.activities?.length ? (
                <p className="text-center text-gray-300 text-[11px] py-8">No activity yet.</p>
              ) : (
                campaign.activities.map((a) => (
                  <div key={a.id} className="flex items-start gap-2 py-1.5">
                    <div className="w-4 pt-0.5 shrink-0 flex justify-center">
                      {ACTIVITY_ICONS[a.type] ?? <Clock size={11} className="text-gray-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[11px] font-medium text-gray-900">{a.title}</span>
                        <span className="text-[9px] text-gray-400 capitalize">{a.actorType}</span>
                        <span className="text-[9px] text-gray-400 ml-auto">
                          {formatRelativeTime(a.createdAt)}
                        </span>
                      </div>
                      {a.body && <p className="text-[10px] text-gray-500 mt-0.5">{a.body}</p>}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'recipients' && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="h-9 border-b border-gray-100 px-3 flex items-center gap-2 shrink-0">
                <select
                  value={recipientStatusFilter}
                  onChange={(e) => setRecipientStatusFilter(e.target.value)}
                  className="text-[11px] border border-gray-200 rounded px-2 py-0.5"
                >
                  <option value="">All statuses</option>
                  <option value="PENDING">Pending</option>
                  <option value="QUEUED">Queued</option>
                  <option value="SENT">Sent</option>
                  <option value="DELIVERED">Delivered</option>
                  <option value="READ">Read</option>
                  <option value="REPLIED">Replied</option>
                  <option value="FAILED">Failed</option>
                  <option value="SKIPPED">Skipped</option>
                  <option value="OPTED_OUT">Opted out</option>
                </select>
                <span className="text-[10px] text-gray-400 ml-auto">
                  {recipients?.total ?? 0} recipient{recipients?.total === 1 ? '' : 's'}
                </span>
              </div>
              <div className="flex-1 overflow-auto">
                {!recipients?.items?.length ? (
                  <p className="text-center text-gray-300 text-[11px] py-8">No recipients.</p>
                ) : (
                  <table className="w-full">
                    <thead className="bg-gray-50/80 border-b border-gray-200 sticky top-0">
                      <tr>
                        {['Contact', 'Status', 'Sent', 'Delivered', 'Replied', 'Error'].map((h) => (
                          <th
                            key={h}
                            className="text-left px-3 py-1.5 text-[9px] font-medium text-gray-400 uppercase tracking-wider"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {recipients.items.map((r) => (
                        <tr key={r.id} className="hover:bg-gray-50/50">
                          <td className="px-3 py-1.5">
                            <code className="text-[10px] text-gray-600">
                              {r.contactId.slice(0, 12)}…
                            </code>
                          </td>
                          <td className="px-3 py-1.5">
                            <span
                              className={cn(
                                'text-[9px] px-1.5 py-0.5 rounded font-medium',
                                r.status === 'FAILED' || r.status === 'OPTED_OUT'
                                  ? 'bg-red-50 text-red-600'
                                  : r.status === 'REPLIED'
                                    ? 'bg-violet-50 text-violet-700'
                                    : r.status === 'READ' || r.status === 'DELIVERED'
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : 'bg-gray-100 text-gray-500',
                              )}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-[10px] text-gray-400">
                            {r.sentAt ? formatRelativeTime(r.sentAt) : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-[10px] text-gray-400">
                            {r.deliveredAt ? formatRelativeTime(r.deliveredAt) : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-[10px] text-gray-400">
                            {r.repliedAt ? formatRelativeTime(r.repliedAt) : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-[10px] text-red-500 truncate max-w-xs">
                            {r.errorReason ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {tab === 'notes' && (
            <div className="flex-1 overflow-auto p-3">
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Add a note to the campaign timeline..."
                rows={4}
                className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400 mb-2"
              />
              <button
                onClick={() => addNoteM.mutate()}
                disabled={!noteDraft.trim() || addNoteM.isPending}
                className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30"
              >
                {addNoteM.isPending ? 'Saving…' : 'Add Note'}
              </button>
              <div className="mt-4 space-y-2">
                {campaign.activities
                  ?.filter((a) => a.type === 'NOTE_ADDED')
                  .map((a) => (
                    <div key={a.id} className="border border-gray-100 rounded p-2">
                      <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                        <span className="capitalize">{a.actorType}</span>
                        <span>{formatRelativeTime(a.createdAt)}</span>
                      </div>
                      <p className="text-[11px] text-gray-700 whitespace-pre-wrap">{a.body}</p>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </main>

        {/* Right panel — quick actions */}
        <aside className="w-52 border-l border-gray-200 bg-white overflow-auto shrink-0 p-3 space-y-2">
          <p className="text-[9px] uppercase tracking-widest text-gray-400 font-medium mb-1">Actions</p>

          {(campaign.status === 'DRAFT' || campaign.status === 'SCHEDULED') && (
            <button
              onClick={() => launchM.mutate()}
              disabled={launchM.isPending}
              className="w-full flex items-center gap-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2.5 py-1.5 rounded text-[11px] font-medium disabled:opacity-50"
            >
              <Rocket size={11} /> Launch now
            </button>
          )}
          {campaign.status === 'SENDING' && (
            <button
              onClick={() => pauseM.mutate()}
              className="w-full flex items-center gap-2 bg-amber-50 hover:bg-amber-100 text-amber-700 px-2.5 py-1.5 rounded text-[11px] font-medium"
            >
              <Pause size={11} /> Pause
            </button>
          )}
          {campaign.status === 'PAUSED' && (
            <button
              onClick={() => resumeM.mutate()}
              className="w-full flex items-center gap-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2.5 py-1.5 rounded text-[11px] font-medium"
            >
              <Play size={11} /> Resume
            </button>
          )}
          {['DRAFT', 'SCHEDULED', 'SENDING', 'PAUSED'].includes(campaign.status) && (
            <button
              onClick={() => {
                if (confirm('Cancel this campaign? Pending recipients will be skipped.')) {
                  cancelM.mutate();
                }
              }}
              className="w-full flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-700 px-2.5 py-1.5 rounded text-[11px] font-medium"
            >
              <XCircle size={11} /> Cancel
            </button>
          )}
          <button
            onClick={() => duplicateM.mutate()}
            className="w-full flex items-center gap-2 bg-gray-50 hover:bg-gray-100 text-gray-700 px-2.5 py-1.5 rounded text-[11px] font-medium"
          >
            <Copy size={11} /> Duplicate
          </button>
          {['DRAFT', 'CANCELLED', 'COMPLETED'].includes(campaign.status) && (
            <button
              onClick={() => {
                if (confirm('Permanently delete this campaign?')) deleteM.mutate();
              }}
              className="w-full flex items-center gap-2 bg-gray-50 hover:bg-red-50 text-gray-700 hover:text-red-700 px-2.5 py-1.5 rounded text-[11px] font-medium"
            >
              <Trash2 size={11} /> Delete
            </button>
          )}

          <div className="pt-2 mt-2 border-t border-gray-100">
            <Link
              href={`/chat?q=${encodeURIComponent(`Tell me about campaign ${campaign.id}`)}`}
              className="w-full flex items-center gap-2 bg-violet-50 hover:bg-violet-100 text-violet-700 px-2.5 py-1.5 rounded text-[11px] font-medium"
            >
              <MessageSquare size={11} /> Ask AI
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-widest text-gray-400 font-medium mb-1.5">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-2', compact ? 'text-[10px]' : 'text-[11px]')}>
      <span className="text-gray-400 shrink-0">{label}</span>
      <span className="text-gray-700 text-right truncate">{value}</span>
    </div>
  );
}
