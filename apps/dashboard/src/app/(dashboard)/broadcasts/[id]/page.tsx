'use client';

/**
 * Broadcast detail page — three-column Linear-style layout matching the
 * leads/deals/tasks/products pattern, plus broadcast-specific extras:
 * recipients table with status filters, audience builder, and quick
 * actions for the state machine (schedule / send / pause / resume / cancel).
 */

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { toast } from 'sonner';
import { cn, formatRelativeTime } from '@/lib/utils';
import {
  ArrowLeft, Save, Send, Calendar, X, Pause, Play, RefreshCw, Trash2,
  Users as UsersIcon, MessageSquare, Activity as ActivityIcon, AlertCircle,
  CheckCircle, Clock, Copy,
} from 'lucide-react';
import { STATUS_COLORS, type BroadcastStatus } from '../page';

interface BroadcastDetail {
  id: string;
  name: string;
  message: string;
  mediaUrl?: string;
  mediaType?: string;
  variables?: Record<string, string>;
  audienceFilter?: { tags?: string[]; contactIds?: string[]; lifecycleStage?: string; scoreMin?: number };
  status: BroadcastStatus;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  deliveredCount: number;
  readCount: number;
  skippedCount: number;
  throttleMs: number;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  countsByStatus: Record<string, number>;
  activities: Array<{
    id: string;
    type: string;
    actorType: string;
    title: string;
    body?: string;
    createdAt: string;
  }>;
}

interface Recipient {
  id: string;
  toPhone: string;
  status: string;
  renderedText: string;
  errorMessage?: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  contact?: { id: string; displayName?: string; phoneNumber: string };
}

const RECIPIENT_STATUSES = ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED'];

export default function BroadcastDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<'recipients' | 'compose' | 'activity'>('recipients');
  const [recipientStatusFilter, setRecipientStatusFilter] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<{ name: string; message: string; mediaUrl: string }>({ name: '', message: '', mediaUrl: '' });
  const [audienceTagsRaw, setAudienceTagsRaw] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');

  const { data: broadcast, isLoading } = useQuery({
    queryKey: ['broadcast', id],
    queryFn: async () => {
      const r = await api.get<{ data: BroadcastDetail }>(`/broadcasts/${id}`);
      return r.data.data;
    },
  });

  const { data: recipientsData } = useQuery({
    queryKey: ['broadcast-recipients', id, recipientStatusFilter],
    enabled: !!id && tab === 'recipients',
    queryFn: async () => {
      const r = await api.get<{ data: { items: Recipient[]; total: number } }>(`/broadcasts/${id}/recipients`, {
        params: { status: recipientStatusFilter || undefined, limit: 100 },
      });
      return r.data.data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/broadcasts/${id}`, data),
    onSuccess: () => { setEditMode(false); toast.success('Saved'); },
    onError: () => toast.error('Save failed'),
  });

  const setAudienceMutation = useMutation({
    mutationFn: (tags: string[]) => api.post(`/broadcasts/${id}/audience`, { tags }),
    onSuccess: (r) => {
      const data = (r.data as { data?: { totalRecipients?: number } }).data;
      toast.success(`Audience set — ${data?.totalRecipients ?? 0} recipients`);
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: (at: string) => api.post(`/broadcasts/${id}/schedule`, { scheduledAt: at }),
    onSuccess: () => toast.success('Scheduled'),
  });

  const sendNowMutation = useMutation({
    mutationFn: () => api.post(`/broadcasts/${id}/send-now`),
    onSuccess: () => toast.success('Send started'),
  });

  const pauseMutation = useMutation({
    mutationFn: () => api.post(`/broadcasts/${id}/pause`),
    onSuccess: () => toast.success('Paused'),
  });

  const resumeMutation = useMutation({
    mutationFn: () => api.post(`/broadcasts/${id}/resume`),
    onSuccess: () => toast.success('Resumed'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.post(`/broadcasts/${id}/cancel`),
    onSuccess: () => toast.success('Cancelled'),
  });

  const retryMutation = useMutation({
    mutationFn: () => api.post(`/broadcasts/${id}/retry-failed`),
    onSuccess: () => toast.success('Retrying failed'),
  });

  const duplicateMutation = useMutation({
    mutationFn: () => api.post(`/broadcasts/${id}/duplicate`, {}),
    onSuccess: (r) => {
      const newId = (r.data as { data?: { id?: string } }).data?.id;
      toast.success('Duplicated');
      if (newId) router.push(`/broadcasts/${newId}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/broadcasts/${id}`),
    onSuccess: () => { toast.success('Deleted'); router.push('/broadcasts'); },
  });

  const startEdit = () => {
    if (!broadcast) return;
    setForm({
      name: broadcast.name,
      message: broadcast.message,
      mediaUrl: broadcast.mediaUrl ?? '',
    });
    setEditMode(true);
  };

  const saveEdit = () => {
    updateMutation.mutate({
      name: form.name,
      message: form.message,
      mediaUrl: form.mediaUrl || null,
    });
  };

  if (isLoading || !broadcast) {
    return <div className="p-12 text-center text-xs text-gray-300">Loading…</div>;
  }

  const editable = broadcast.status === 'DRAFT' || broadcast.status === 'SCHEDULED';
  const audienceLocked = broadcast.status !== 'DRAFT';
  const progress = broadcast.totalRecipients > 0 ? Math.round((broadcast.sentCount / broadcast.totalRecipients) * 100) : 0;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => router.push('/broadcasts')} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft size={14} />
          </button>
          <span className="text-xs font-semibold text-gray-900 truncate max-w-md">{broadcast.name}</span>
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium', STATUS_COLORS[broadcast.status])}>
            {broadcast.status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {editable && !editMode && (
            <button onClick={startEdit} className="text-[11px] text-violet-600 hover:text-violet-700">Edit</button>
          )}
          {editMode && (
            <>
              <button onClick={() => setEditMode(false)} className="text-[11px] text-gray-500">Cancel</button>
              <button onClick={saveEdit} disabled={updateMutation.isPending} className="text-[11px] bg-gray-900 text-white px-2.5 py-0.5 rounded flex items-center gap-1 disabled:opacity-30">
                <Save size={10} /> Save
              </button>
            </>
          )}
          <button
            onClick={() => duplicateMutation.mutate()}
            className="text-gray-400 hover:text-violet-500 p-1"
            title="Duplicate"
          >
            <Copy size={12} />
          </button>
          {(broadcast.status === 'DRAFT' || broadcast.status === 'COMPLETED' || broadcast.status === 'CANCELLED' || broadcast.status === 'FAILED') && (
            <button
              onClick={() => { if (confirm('Delete this broadcast?')) deleteMutation.mutate(); }}
              className="text-gray-400 hover:text-red-500 p-1"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Left: info */}
        <aside className="w-72 border-r border-gray-200 bg-white overflow-auto p-3 space-y-3 shrink-0">
          {!editMode ? (
            <>
              <Field label="Audience" value={
                <div className="text-[11px]">
                  <div className="font-semibold text-gray-900">{broadcast.totalRecipients} recipient{broadcast.totalRecipients === 1 ? '' : 's'}</div>
                  {broadcast.audienceFilter?.tags?.length ? (
                    <div className="text-[10px] text-gray-500 mt-0.5">Tags: {broadcast.audienceFilter.tags.join(', ')}</div>
                  ) : null}
                </div>
              } />
              {broadcast.totalRecipients > 0 && (
                <Field label="Progress" value={
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex-1 bg-gray-100 rounded-full h-1">
                        <div className="bg-violet-500 h-1 rounded-full transition-all" style={{ width: `${progress}%` }} />
                      </div>
                      <span className="text-[10px] text-gray-500">{progress}%</span>
                    </div>
                    <div className="text-[10px] text-gray-500 space-y-0.5">
                      <div>✓ Sent: {broadcast.sentCount}</div>
                      <div className="text-emerald-600">📨 Delivered: {broadcast.deliveredCount}</div>
                      <div className="text-blue-600">👁 Read: {broadcast.readCount}</div>
                      {broadcast.failedCount > 0 && <div className="text-red-600">✗ Failed: {broadcast.failedCount}</div>}
                      {broadcast.skippedCount > 0 && <div className="text-gray-400">↷ Skipped: {broadcast.skippedCount}</div>}
                    </div>
                  </div>
                } />
              )}
              {broadcast.scheduledAt && (
                <Field label="Scheduled for" value={
                  <span className="text-[11px] text-amber-700">{new Date(broadcast.scheduledAt).toLocaleString()}</span>
                } />
              )}
              {broadcast.startedAt && <Field label="Started" value={formatRelativeTime(broadcast.startedAt)} />}
              {broadcast.completedAt && <Field label="Completed" value={formatRelativeTime(broadcast.completedAt)} />}
              <Field label="Throttle" value={`${broadcast.throttleMs}ms between sends`} />
              {broadcast.errorMessage && (
                <Field label="Error" value={
                  <span className="text-[11px] text-red-600">{broadcast.errorMessage}</span>
                } />
              )}
              <Field label="Created" value={formatRelativeTime(broadcast.createdAt)} />
            </>
          ) : (
            <>
              <EditField label="Name">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
              </EditField>
              <EditField label="Message">
                <textarea
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  rows={6}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-[11px] resize-none font-mono"
                />
                <p className="text-[9px] text-gray-400 mt-1">
                  Vars: {`{{firstName}}, {{lastName}}, {{name}}, {{phoneNumber}}, {{email}}, {{company}}`}
                </p>
              </EditField>
              <EditField label="Media URL">
                <input value={form.mediaUrl} onChange={(e) => setForm({ ...form, mediaUrl: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
              </EditField>
            </>
          )}
        </aside>

        {/* Center: tabs */}
        <main className="flex-1 overflow-auto bg-white">
          <div className="border-b border-gray-100 px-4 flex items-center gap-3">
            {([
              ['recipients', 'Recipients', broadcast.totalRecipients, UsersIcon],
              ['compose', 'Message', null, MessageSquare],
              ['activity', 'Activity', null, ActivityIcon],
            ] as const).map(([key, label, count, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  'text-[11px] py-2 border-b-2 transition flex items-center gap-1.5',
                  tab === key ? 'border-violet-500 text-violet-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700',
                )}
              >
                <Icon size={11} /> {label}
                {count !== null && count > 0 && <span className="text-[10px] text-gray-400">({count})</span>}
              </button>
            ))}
          </div>

          {tab === 'recipients' && (
            <div className="p-4 space-y-3">
              {/* Audience builder (only in DRAFT) */}
              {!audienceLocked && (
                <div className="border border-violet-200 bg-violet-50/30 rounded p-3 space-y-2">
                  <p className="text-[11px] font-medium text-gray-700">Set audience by tags</p>
                  <div className="flex gap-2">
                    <input
                      value={audienceTagsRaw}
                      onChange={(e) => setAudienceTagsRaw(e.target.value)}
                      placeholder="tag1, tag2, tag3"
                      className="flex-1 border border-gray-200 rounded px-2.5 py-1.5 text-xs"
                    />
                    <button
                      onClick={() => {
                        const tags = audienceTagsRaw.split(',').map((t) => t.trim()).filter(Boolean);
                        if (tags.length > 0) setAudienceMutation.mutate(tags);
                      }}
                      disabled={!audienceTagsRaw.trim() || setAudienceMutation.isPending}
                      className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30"
                    >
                      Apply
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-500">
                    Setting the audience snapshots all matching contacts and renders their personalized messages.
                  </p>
                </div>
              )}

              {/* Status filter chips */}
              {broadcast.totalRecipients > 0 && (
                <div className="flex gap-1 flex-wrap">
                  <button
                    onClick={() => setRecipientStatusFilter('')}
                    className={cn('text-[10px] px-2 py-0.5 rounded', !recipientStatusFilter ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100')}
                  >
                    All ({broadcast.totalRecipients})
                  </button>
                  {RECIPIENT_STATUSES.map((s) => {
                    const count = broadcast.countsByStatus[s] ?? 0;
                    if (count === 0) return null;
                    return (
                      <button
                        key={s}
                        onClick={() => setRecipientStatusFilter(s)}
                        className={cn('text-[10px] px-2 py-0.5 rounded', recipientStatusFilter === s ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100')}
                      >
                        {s} ({count})
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Recipients table */}
              {broadcast.totalRecipients === 0 ? (
                <p className="text-[11px] text-gray-300 text-center py-6">
                  No audience set yet. {audienceLocked ? '' : 'Use the form above.'}
                </p>
              ) : !recipientsData?.items?.length ? (
                <p className="text-[11px] text-gray-300 text-center py-6">No recipients match.</p>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50/80 border-b border-gray-200">
                    <tr>
                      {['Contact', 'Status', 'Sent', ''].map((h) => (
                        <th key={h} className="text-left px-2 py-1 text-[9px] font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {recipientsData.items.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50/50">
                        <td className="px-2 py-1.5">
                          <div className="text-[11px] font-medium text-gray-900">{r.contact?.displayName ?? r.toPhone}</div>
                          <div className="text-[10px] text-gray-400">{r.toPhone}</div>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded font-medium',
                            r.status === 'SENT' || r.status === 'DELIVERED' || r.status === 'READ' ? 'bg-emerald-50 text-emerald-700' :
                            r.status === 'FAILED' ? 'bg-red-50 text-red-700' :
                            r.status === 'SKIPPED' ? 'bg-gray-100 text-gray-500' :
                            'bg-blue-50 text-blue-700',
                          )}>
                            {r.status}
                          </span>
                          {r.errorMessage && (
                            <div className="text-[9px] text-red-500 mt-0.5">{r.errorMessage.slice(0, 60)}</div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-[10px] text-gray-400">
                          {r.sentAt ? formatRelativeTime(r.sentAt) : '—'}
                        </td>
                        <td className="px-2 py-1.5"></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'compose' && (
            <div className="p-4 space-y-3">
              <p className="text-[11px] text-gray-500">Message preview (raw — variables not rendered)</p>
              <div className="border border-gray-200 rounded p-3 bg-gray-50/50">
                <pre className="text-[12px] text-gray-800 whitespace-pre-wrap font-sans">{broadcast.message}</pre>
                {broadcast.mediaUrl && (
                  <p className="text-[10px] text-violet-600 mt-2">📎 Media: {broadcast.mediaUrl}</p>
                )}
              </div>
              <p className="text-[10px] text-gray-400">
                Recipients have their personalized text rendered when audience is set.
                Edit the message in the left panel (DRAFT/SCHEDULED only).
              </p>
            </div>
          )}

          {tab === 'activity' && (
            <div className="p-4 space-y-2">
              {broadcast.activities.length === 0 ? (
                <p className="text-[11px] text-gray-300 text-center py-6">No activity yet.</p>
              ) : (
                broadcast.activities.map((a) => (
                  <div key={a.id} className="flex gap-2">
                    <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-violet-300 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                        <span className="font-mono uppercase tracking-wider">{a.type}</span>
                        <span>·</span>
                        <span>{a.actorType}</span>
                        <span>·</span>
                        <span>{formatRelativeTime(a.createdAt)}</span>
                      </div>
                      <div className="text-[11px] text-gray-800 mt-0.5">{a.title}</div>
                      {a.body && <div className="text-[10px] text-gray-500 mt-0.5 whitespace-pre-wrap">{a.body}</div>}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </main>

        {/* Right: actions */}
        <aside className="w-60 border-l border-gray-200 bg-white overflow-auto p-3 space-y-3 shrink-0">
          <div>
            <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-1.5">Quick actions</p>
            <div className="space-y-1">
              {broadcast.status === 'DRAFT' && broadcast.totalRecipients > 0 && (
                <>
                  <div className="border border-violet-200 rounded p-2 space-y-1">
                    <input
                      type="datetime-local"
                      value={scheduleAt}
                      onChange={(e) => setScheduleAt(e.target.value)}
                      className="w-full border border-gray-200 rounded px-2 py-1 text-[10px]"
                    />
                    <button
                      onClick={() => { if (scheduleAt) scheduleMutation.mutate(scheduleAt); }}
                      disabled={!scheduleAt}
                      className="w-full text-[11px] bg-amber-500 text-white px-2 py-1 rounded flex items-center justify-center gap-1 disabled:opacity-30"
                    >
                      <Calendar size={11} /> Schedule
                    </button>
                  </div>
                  <button
                    onClick={() => sendNowMutation.mutate()}
                    className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                  >
                    <Send size={11} /> Send now
                  </button>
                </>
              )}
              {broadcast.status === 'SCHEDULED' && (
                <>
                  <button
                    onClick={() => sendNowMutation.mutate()}
                    className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                  >
                    <Send size={11} /> Send now
                  </button>
                  <button
                    onClick={() => api.post(`/broadcasts/${id}/unschedule`).then(() => toast.success('Unscheduled'))}
                    className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-gray-200 text-gray-700 hover:bg-gray-50"
                  >
                    <Clock size={11} /> Unschedule
                  </button>
                  <button
                    onClick={() => cancelMutation.mutate()}
                    className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-red-200 text-red-700 hover:bg-red-50"
                  >
                    <X size={11} /> Cancel
                  </button>
                </>
              )}
              {broadcast.status === 'SENDING' && (
                <>
                  <button
                    onClick={() => pauseMutation.mutate()}
                    className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-orange-200 text-orange-700 hover:bg-orange-50"
                  >
                    <Pause size={11} /> Pause
                  </button>
                  <button
                    onClick={() => cancelMutation.mutate()}
                    className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-red-200 text-red-700 hover:bg-red-50"
                  >
                    <X size={11} /> Cancel
                  </button>
                </>
              )}
              {broadcast.status === 'PAUSED' && (
                <button
                  onClick={() => resumeMutation.mutate()}
                  className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-blue-200 text-blue-700 hover:bg-blue-50"
                >
                  <Play size={11} /> Resume
                </button>
              )}
              {(broadcast.status === 'COMPLETED' || broadcast.status === 'FAILED' || broadcast.status === 'PAUSED') && broadcast.failedCount > 0 && (
                <button
                  onClick={() => retryMutation.mutate()}
                  className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-violet-200 text-violet-700 hover:bg-violet-50"
                >
                  <RefreshCw size={11} /> Retry {broadcast.failedCount} failed
                </button>
              )}
              <button
                onClick={() => duplicateMutation.mutate()}
                className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-gray-200 text-gray-700 hover:bg-gray-50"
              >
                <Copy size={11} /> Duplicate
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-widest text-gray-400">{label}</p>
      <div className="text-[11px] text-gray-700 mt-0.5">{value}</div>
    </div>
  );
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-0.5">{label}</p>
      {children}
    </div>
  );
}
