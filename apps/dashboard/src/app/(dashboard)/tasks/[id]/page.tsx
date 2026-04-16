'use client';

/**
 * Task detail page — three-column Linear-style layout matching /leads/[id]
 * and /deals/[id], plus task-specific extras: subtasks checklist, comments
 * thread, time tracking, watchers.
 */

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { toast } from 'sonner';
import { cn, formatRelativeTime } from '@/lib/utils';
import {
  ArrowLeft, Save, CheckCircle, XCircle, Play, RefreshCw, Trash2, Plus,
  X, MessageSquare, Activity as ActivityIcon, ListChecks, AlertCircle, Clock,
  Pencil, Check,
} from 'lucide-react';
import { PRIORITY_COLORS, STATUS_COLORS, type TaskStatus, type TaskPriority, type TaskSource } from '../page';

interface TaskDetail {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  source: TaskSource;
  tags: string[];
  estimatedHours?: number;
  actualHours?: number;
  dueAt?: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  reminderOffsets: number[];
  parentTaskId?: string;
  recurrenceId?: string;
  contact?: { id: string; displayName?: string; phoneNumber: string };
  deal?: { id: string; title: string; stage: string; value: number; currency: string };
  lead?: { id: string; title: string; status: string };
  assignedAgent?: { id: string; firstName: string; lastName: string; avatarUrl?: string };
  createdBy?: { id: string; firstName: string; lastName: string };
  recurrence?: { id: string; templateTitle: string; frequency: string };
  subtasks: Array<{
    id: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueAt?: string;
    position: number;
  }>;
  comments: Array<{
    id: string;
    body: string;
    authorId?: string;
    createdAt: string;
  }>;
  watchers: Array<{ id: string; userId: string }>;
  activities: Array<{
    id: string;
    type: string;
    actorType: string;
    title: string;
    body?: string;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

const PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'];

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'subtasks' | 'comments' | 'activity'>('subtasks');
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [commentBody, setCommentBody] = useState('');
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [logHours, setLogHours] = useState('');
  // Inline subtask title edit — only one at a time.
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [editingSubtaskTitle, setEditingSubtaskTitle] = useState('');

  const { data: task, isLoading } = useQuery({
    queryKey: ['task', id],
    queryFn: async () => {
      const r = await api.get<{ data: TaskDetail }>(`/tasks/${id}`);
      return r.data.data;
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['task', id] });
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['task-stats'] });
  };

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/tasks/${id}`, data),
    onSuccess: () => { invalidate(); setEditMode(false); toast.success('Saved'); },
    onError: () => toast.error('Save failed'),
  });

  const statusMutation = useMutation({
    mutationFn: (status: TaskStatus) => api.post(`/tasks/${id}/status`, { status }),
    onSuccess: () => { invalidate(); toast.success('Status updated'); },
  });

  const commentMutation = useMutation({
    mutationFn: (body: string) => api.post(`/tasks/${id}/comments`, { body }),
    onSuccess: () => { invalidate(); setCommentBody(''); toast.success('Comment added'); },
  });

  const subtaskMutation = useMutation({
    mutationFn: (title: string) => api.post(`/tasks/${id}/subtasks`, { title }),
    onSuccess: () => { invalidate(); setNewSubtaskTitle(''); toast.success('Subtask added'); },
  });

  const subtaskCompleteMutation = useMutation({
    mutationFn: (subtaskId: string) => api.post(`/tasks/${subtaskId}/complete`),
    onSuccess: () => invalidate(),
  });

  const subtaskDeleteMutation = useMutation({
    mutationFn: (subtaskId: string) => api.delete(`/tasks/${subtaskId}`),
    onSuccess: () => invalidate(),
  });

  const subtaskUpdateMutation = useMutation({
    mutationFn: ({ subtaskId, title }: { subtaskId: string; title: string }) =>
      api.patch(`/tasks/${subtaskId}`, { title }),
    onSuccess: () => {
      invalidate();
      setEditingSubtaskId(null);
      setEditingSubtaskTitle('');
      toast.success('Subtask updated');
    },
    onError: () => toast.error('Failed to update'),
  });

  const logTimeMutation = useMutation({
    mutationFn: (hours: number) => api.post(`/tasks/${id}/log-time`, { hours }),
    onSuccess: () => { invalidate(); setLogHours(''); toast.success('Time logged'); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/tasks/${id}`),
    onSuccess: () => { toast.success('Deleted'); router.push('/tasks'); },
  });

  const startEdit = () => {
    if (!task) return;
    setForm({
      title: task.title,
      description: task.description ?? '',
      priority: task.priority,
      dueAt: task.dueAt?.slice(0, 16) ?? '',
      tags: task.tags.join(', '),
      estimatedHours: task.estimatedHours?.toString() ?? '',
      reminderOffsets: task.reminderOffsets.join(', '),
    });
    setEditMode(true);
  };

  const saveEdit = () => {
    updateMutation.mutate({
      title: form.title,
      description: form.description || null,
      priority: form.priority,
      dueAt: form.dueAt || null,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      estimatedHours: form.estimatedHours ? Number(form.estimatedHours) : null,
      reminderOffsets: form.reminderOffsets.split(',').map((v) => Number(v.trim())).filter((n) => !Number.isNaN(n) && n > 0),
    });
  };

  if (isLoading || !task) {
    return <div className="p-12 text-center text-xs text-gray-300">Loading…</div>;
  }

  const isClosed = task.status === 'DONE' || task.status === 'CANCELLED';
  const isOverdue = task.dueAt && new Date(task.dueAt) < new Date() && !isClosed;
  const subtasksDone = task.subtasks.filter((s) => s.status === 'DONE').length;
  const subtasksTotal = task.subtasks.length;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => router.push('/tasks')} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft size={14} />
          </button>
          <span className="text-xs font-semibold text-gray-900 truncate max-w-md">{task.title}</span>
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium', STATUS_COLORS[task.status])}>
            {task.status.replace('_', ' ')}
          </span>
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium', PRIORITY_COLORS[task.priority])}>
            {task.priority}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!editMode ? (
            <button onClick={startEdit} className="text-[11px] text-gray-900 hover:text-gray-900">Edit</button>
          ) : (
            <>
              <button onClick={() => setEditMode(false)} className="text-[11px] text-gray-500">Cancel</button>
              <button
                onClick={saveEdit}
                disabled={updateMutation.isPending}
                className="text-[11px] bg-gray-900 text-white px-2.5 py-0.5 rounded flex items-center gap-1 disabled:opacity-30"
              >
                <Save size={10} /> Save
              </button>
            </>
          )}
          <button
            onClick={() => { if (confirm('Delete this task?')) deleteMutation.mutate(); }}
            className="text-gray-400 hover:text-red-500 p-1"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Left: info */}
        <aside className="w-72 border-r border-gray-200 bg-white overflow-auto p-3 space-y-3 shrink-0">
          {!editMode ? (
            <>
              {task.description && (
                <Field label="Description" value={
                  <p className="text-[11px] text-gray-600 whitespace-pre-wrap">{task.description}</p>
                } />
              )}
              <Field label="Due" value={
                task.dueAt ? (
                  <span className={cn('flex items-center gap-1', isOverdue && 'text-red-600 font-medium')}>
                    {isOverdue && <AlertCircle size={11} />}
                    {new Date(task.dueAt).toLocaleString()}
                  </span>
                ) : '—'
              } />
              <Field label="Source" value={task.source} />
              {task.recurrence && (
                <Field label="Recurring series" value={
                  <span className="text-[11px] text-gray-900">{task.recurrence.templateTitle} · {task.recurrence.frequency}</span>
                } />
              )}
              <Field label="Assigned" value={
                task.assignedAgent ? `${task.assignedAgent.firstName} ${task.assignedAgent.lastName}` : 'Unassigned'
              } />
              <Field label="Watchers" value={
                task.watchers.length === 0 ? '—' : `${task.watchers.length} user${task.watchers.length === 1 ? '' : 's'}`
              } />
              {task.contact && (
                <Field label="Contact" value={
                  <div className="text-[11px]">
                    <div className="font-medium text-gray-900">{task.contact.displayName ?? task.contact.phoneNumber}</div>
                    <div className="text-gray-400">{task.contact.phoneNumber}</div>
                  </div>
                } />
              )}
              {task.deal && (
                <Field label="Deal" value={
                  <span className="text-[11px] text-gray-900">{task.deal.title}</span>
                } />
              )}
              {task.lead && (
                <Field label="Lead" value={
                  <span className="text-[11px] text-gray-900">{task.lead.title}</span>
                } />
              )}
              <Field label="Tags" value={
                <div className="flex flex-wrap gap-1">
                  {task.tags.length === 0 ? '—' : task.tags.map((t) => (
                    <span key={t} className="text-[9px] bg-gray-50 text-gray-900 px-1.5 py-0.5 rounded">{t}</span>
                  ))}
                </div>
              } />

              {/* Time tracking */}
              <Field label="Time" value={
                <div className="text-[11px]">
                  <div>
                    {task.actualHours ?? 0}h logged
                    {task.estimatedHours && <> / {task.estimatedHours}h est.</>}
                  </div>
                  <div className="flex gap-1 mt-1">
                    <input
                      type="number"
                      step="0.25"
                      value={logHours}
                      onChange={(e) => setLogHours(e.target.value)}
                      placeholder="hours"
                      className="w-16 border border-gray-200 rounded px-1.5 py-0.5 text-[11px]"
                    />
                    <button
                      onClick={() => { const h = Number(logHours); if (h > 0) logTimeMutation.mutate(h); }}
                      className="text-[10px] bg-gray-900 text-white px-2 rounded"
                    >
                      Log
                    </button>
                  </div>
                </div>
              } />

              <Field label="Reminders" value={
                <span className="text-[11px] text-gray-600">{task.reminderOffsets.join(', ')} min before</span>
              } />

              {task.cancelReason && (
                <Field label="Cancel reason" value={
                  <span className="text-[11px] text-red-600">{task.cancelReason}</span>
                } />
              )}

              <Field label="Created" value={formatRelativeTime(task.createdAt)} />
              {task.startedAt && <Field label="Started" value={formatRelativeTime(task.startedAt)} />}
              {task.completedAt && <Field label="Completed" value={formatRelativeTime(task.completedAt)} />}
            </>
          ) : (
            <>
              <EditField label="Title">
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
              </EditField>
              <EditField label="Description">
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px] resize-none" />
              </EditField>
              <EditField label="Priority">
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px] bg-white">
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </EditField>
              <EditField label="Due">
                <input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
              </EditField>
              <EditField label="Tags (comma)">
                <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
              </EditField>
              <EditField label="Estimated hours">
                <input type="number" step="0.25" value={form.estimatedHours} onChange={(e) => setForm({ ...form, estimatedHours: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
              </EditField>
              <EditField label="Reminder offsets (min, comma)">
                <input value={form.reminderOffsets} onChange={(e) => setForm({ ...form, reminderOffsets: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
              </EditField>
            </>
          )}
        </aside>

        {/* Center: tabbed content */}
        <main className="flex-1 overflow-auto bg-white">
          <div className="border-b border-gray-100 px-4 flex items-center gap-3">
            {([
              ['subtasks', 'Subtasks', subtasksTotal > 0 ? `${subtasksDone}/${subtasksTotal}` : null, ListChecks],
              ['comments', 'Comments', task.comments.length || null, MessageSquare],
              ['activity', 'Activity', null, ActivityIcon],
            ] as const).map(([key, label, count, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  'text-[11px] py-2 border-b-2 transition flex items-center gap-1.5',
                  tab === key ? 'border-gray-800 text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700',
                )}
              >
                <Icon size={11} /> {label}
                {count && <span className="text-[10px] text-gray-400">({count})</span>}
              </button>
            ))}
          </div>

          {tab === 'subtasks' && (
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <input
                  value={newSubtaskTitle}
                  onChange={(e) => setNewSubtaskTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && newSubtaskTitle.trim()) subtaskMutation.mutate(newSubtaskTitle.trim()); }}
                  placeholder="Add subtask…"
                  className="flex-1 border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
                <button
                  onClick={() => { if (newSubtaskTitle.trim()) subtaskMutation.mutate(newSubtaskTitle.trim()); }}
                  disabled={!newSubtaskTitle.trim()}
                  className="bg-gray-900 text-white px-3 rounded text-[11px] disabled:opacity-30 flex items-center gap-1"
                >
                  <Plus size={11} /> Add
                </button>
              </div>
              {subtasksTotal === 0 ? (
                <p className="text-[11px] text-gray-300 text-center py-6">No subtasks yet.</p>
              ) : (
                <div className="space-y-1">
                  {task.subtasks.map((s) => {
                    const isEditing = editingSubtaskId === s.id;
                    return (
                      <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50/50 group">
                        <button
                          onClick={() => subtaskCompleteMutation.mutate(s.id)}
                          disabled={isEditing}
                          className={cn(
                            'w-4 h-4 rounded border shrink-0 flex items-center justify-center',
                            s.status === 'DONE' ? 'border-gray-400 bg-gray-50' : 'border-gray-200 hover:border-gray-400',
                            isEditing && 'opacity-50',
                          )}
                        >
                          {s.status === 'DONE' && <div className="w-2 h-2 bg-gray-800 rounded-sm" />}
                        </button>
                        {isEditing ? (
                          <>
                            <input
                              value={editingSubtaskTitle}
                              onChange={(e) => setEditingSubtaskTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const next = editingSubtaskTitle.trim();
                                  if (!next || next === s.title) {
                                    setEditingSubtaskId(null);
                                    setEditingSubtaskTitle('');
                                    return;
                                  }
                                  subtaskUpdateMutation.mutate({ subtaskId: s.id, title: next });
                                } else if (e.key === 'Escape') {
                                  setEditingSubtaskId(null);
                                  setEditingSubtaskTitle('');
                                }
                              }}
                              autoFocus
                              className="flex-1 border border-gray-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
                            />
                            <button
                              onClick={() => {
                                const next = editingSubtaskTitle.trim();
                                if (!next || next === s.title) {
                                  setEditingSubtaskId(null);
                                  setEditingSubtaskTitle('');
                                  return;
                                }
                                subtaskUpdateMutation.mutate({ subtaskId: s.id, title: next });
                              }}
                              disabled={subtaskUpdateMutation.isPending || !editingSubtaskTitle.trim()}
                              className="text-gray-400 hover:text-gray-900 disabled:opacity-30"
                              title="Save"
                            >
                              <Check size={11} />
                            </button>
                            <button
                              onClick={() => { setEditingSubtaskId(null); setEditingSubtaskTitle(''); }}
                              className="text-gray-400 hover:text-gray-700"
                              title="Cancel"
                            >
                              <X size={11} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => { setEditingSubtaskId(s.id); setEditingSubtaskTitle(s.title); }}
                              className={cn(
                                'text-[11px] flex-1 text-left truncate',
                                s.status === 'DONE' && 'line-through text-gray-400',
                              )}
                              title="Click to edit"
                            >
                              {s.title}
                            </button>
                            <span className={cn('text-[9px] px-1 rounded border', PRIORITY_COLORS[s.priority])}>{s.priority}</span>
                            <button
                              onClick={() => { setEditingSubtaskId(s.id); setEditingSubtaskTitle(s.title); }}
                              className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-700 p-0.5 rounded hover:bg-gray-100 transition-opacity"
                              title="Edit subtask"
                            >
                              <Pencil size={10} />
                            </button>
                            <button
                              onClick={() => { if (confirm('Delete subtask?')) subtaskDeleteMutation.mutate(s.id); }}
                              className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-0.5 rounded hover:bg-gray-100 transition-opacity"
                              title="Delete subtask"
                            >
                              <Trash2 size={10} />
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'comments' && (
            <div className="p-4 space-y-3">
              <div className="border border-gray-200 rounded-lg p-2">
                <textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="Write a comment…"
                  rows={2}
                  className="w-full text-[11px] resize-none focus:outline-none placeholder:text-gray-300"
                />
                <div className="flex justify-end">
                  <button
                    onClick={() => { if (commentBody.trim()) commentMutation.mutate(commentBody.trim()); }}
                    disabled={!commentBody.trim()}
                    className="bg-gray-900 text-white px-2.5 py-0.5 rounded text-[10px] disabled:opacity-30"
                  >
                    Post
                  </button>
                </div>
              </div>
              {task.comments.length === 0 ? (
                <p className="text-[11px] text-gray-300 text-center py-6">No comments yet.</p>
              ) : (
                <div className="space-y-2">
                  {task.comments.map((c) => (
                    <div key={c.id} className="border border-gray-100 rounded p-2">
                      <div className="text-[10px] text-gray-400 mb-1">
                        {c.authorId ?? 'system'} · {formatRelativeTime(c.createdAt)}
                      </div>
                      <p className="text-[11px] text-gray-700 whitespace-pre-wrap">{c.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'activity' && (
            <div className="p-4 space-y-2">
              {task.activities.length === 0 ? (
                <p className="text-[11px] text-gray-300 text-center py-6">No activity yet.</p>
              ) : (
                task.activities.map((a) => (
                  <div key={a.id} className="flex gap-2">
                    <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-gray-300 shrink-0" />
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
            <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-1.5">Status</p>
            <select
              value={task.status}
              onChange={(e) => statusMutation.mutate(e.target.value as TaskStatus)}
              className="w-full text-[11px] border border-gray-200 rounded px-2 py-1.5 bg-white"
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </div>

          <div>
            <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-1.5">Quick actions</p>
            <div className="space-y-1">
              {!isClosed && task.status !== 'IN_PROGRESS' && (
                <button
                  onClick={() => statusMutation.mutate('IN_PROGRESS')}
                  className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-gray-200 text-gray-900 hover:bg-gray-50"
                >
                  <Play size={11} /> Start
                </button>
              )}
              {!isClosed && (
                <button
                  onClick={() => statusMutation.mutate('DONE')}
                  className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                >
                  <CheckCircle size={11} /> Mark done
                </button>
              )}
              {!isClosed && (
                <button
                  onClick={() => {
                    const reason = prompt('Cancel reason?');
                    if (reason) {
                      api.post(`/tasks/${id}/status`, { status: 'CANCELLED', reason }).then(() => invalidate());
                    }
                  }}
                  className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-red-200 text-red-700 hover:bg-red-50"
                >
                  <XCircle size={11} /> Cancel
                </button>
              )}
              {isClosed && (
                <button
                  onClick={() => statusMutation.mutate('TODO')}
                  className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-gray-200 text-gray-900 hover:bg-gray-50"
                >
                  <RefreshCw size={11} /> Reopen
                </button>
              )}
            </div>
          </div>

          <div>
            <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-1.5">Snooze</p>
            <div className="grid grid-cols-2 gap-1">
              {[
                ['1h', 60],
                ['4h', 240],
                ['1d', 1440],
                ['1w', 10080],
              ].map(([label, mins]) => (
                <button
                  key={label}
                  onClick={() => api.post(`/tasks/${id}/snooze`, { minutes: mins }).then(() => invalidate())}
                  className="text-[10px] border border-gray-200 hover:border-gray-300 rounded px-2 py-1 flex items-center justify-center gap-1"
                >
                  <Clock size={9} /> {label}
                </button>
              ))}
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
