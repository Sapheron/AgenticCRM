'use client';

/**
 * Lead detail page — three-column Linear-style layout matching contacts/[id].
 *
 *  Left:   Info panel (status, score, value, contact, edit/save form)
 *  Center: Activity timeline + inline note composer
 *  Right:  Linked deals + quick actions (qualify, convert, won/lost)
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { toast } from 'sonner';
import { cn, formatRelativeTime } from '@/lib/utils';
import {
  ArrowLeft, Save, Phone, Award,
  StickyNote, CheckCircle, XCircle, ArrowRight, RefreshCw, Trash2,
  Pencil, Check, X,
} from 'lucide-react';
import { STATUS_COLORS, type LeadStatus, type LeadSource, type LeadPriority } from '../page';

interface LeadDetail {
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
  notes?: string;
  expectedCloseAt?: string;
  nextActionAt?: string;
  nextActionNote?: string;
  qualifiedAt?: string;
  wonAt?: string;
  lostAt?: string;
  lostReason?: string;
  createdAt: string;
  updatedAt: string;
  contact: { id: string; displayName?: string; phoneNumber: string };
  assignedAgent?: { id: string; firstName: string; lastName: string; avatarUrl?: string };
  deals: Array<{ id: string; title: string; stage: string; value: number; currency: string }>;
  activities: Array<TimelineActivity>;
}

interface TimelineActivity {
  id: string;
  type: string;
  actorType: string;
  title: string;
  body?: string;
  createdAt: string;
}

interface ScoreEvent {
  id: string;
  delta: number;
  newScore: number;
  reason: string;
  source: string;
  createdAt: string;
}

const PRIORITIES: LeadPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const SOURCES: LeadSource[] = ['WHATSAPP', 'WEBSITE', 'REFERRAL', 'INBOUND_EMAIL', 'OUTBOUND', 'CAMPAIGN', 'FORM', 'IMPORT', 'AI_CHAT', 'MANUAL', 'OTHER'];

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [noteText, setNoteText] = useState('');
  // Inline note editing — only one note at a time.
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');
  const [showContactEdit, setShowContactEdit] = useState(false);

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', id],
    queryFn: async () => {
      const r = await api.get<{ data: LeadDetail }>(`/leads/${id}`);
      return r.data.data;
    },
  });

  const { data: scoreHistory } = useQuery({
    queryKey: ['lead-score-history', id],
    queryFn: async () => {
      const r = await api.get<{ data: ScoreEvent[] }>(`/leads/${id}/score-history`);
      return r.data.data;
    },
    enabled: !!id,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['lead', id] });
    void qc.invalidateQueries({ queryKey: ['lead-score-history', id] });
    void qc.invalidateQueries({ queryKey: ['leads'] });
  };

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/leads/${id}`, data),
    onSuccess: () => { invalidate(); setEditMode(false); toast.success('Saved'); },
    onError: () => toast.error('Save failed'),
  });

  const statusMutation = useMutation({
    mutationFn: (status: LeadStatus) => api.post(`/leads/${id}/status`, { status }),
    onSuccess: () => { invalidate(); toast.success('Status updated'); },
  });

  const noteMutation = useMutation({
    mutationFn: (body: string) => api.post(`/leads/${id}/notes`, { body }),
    onSuccess: () => { invalidate(); setNoteText(''); toast.success('Note added'); },
  });

  const updateNoteMutation = useMutation({
    mutationFn: ({ activityId, body }: { activityId: string; body: string }) =>
      api.patch(`/leads/${id}/notes/${activityId}`, { body }),
    onSuccess: () => {
      invalidate();
      setEditingNoteId(null);
      setEditingNoteText('');
      toast.success('Note updated');
    },
    onError: () => toast.error('Failed to update'),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (activityId: string) => api.delete(`/leads/${id}/notes/${activityId}`),
    onSuccess: () => { invalidate(); toast.success('Note deleted'); },
    onError: () => toast.error('Failed to delete'),
  });

  const recalcMutation = useMutation({
    mutationFn: () => api.post(`/leads/${id}/recalculate`),
    onSuccess: () => { invalidate(); toast.success('Score recalculated'); },
  });

  const convertMutation = useMutation({
    mutationFn: () => api.post(`/leads/${id}/convert`, { value: lead?.estimatedValue, currency: lead?.currency }),
    onSuccess: (r) => {
      invalidate();
      toast.success('Converted to deal');
      const dealId = (r.data as { data?: { dealId?: string } })?.data?.dealId;
      if (dealId) router.push(`/deals`);
    },
    onError: () => toast.error('Convert failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/leads/${id}`),
    onSuccess: () => { toast.success('Deleted'); router.push('/leads'); },
  });

  const startEdit = () => {
    if (!lead) return;
    setForm({
      title: lead.title,
      priority: lead.priority,
      source: lead.source,
      estimatedValue: lead.estimatedValue?.toString() ?? '',
      currency: lead.currency,
      probability: lead.probability.toString(),
      tags: lead.tags.join(', '),
      expectedCloseAt: lead.expectedCloseAt?.slice(0, 10) ?? '',
      nextActionAt: lead.nextActionAt?.slice(0, 16) ?? '',
      nextActionNote: lead.nextActionNote ?? '',
      notes: lead.notes ?? '',
    });
    setEditMode(true);
  };

  const saveEdit = () => {
    updateMutation.mutate({
      title: form.title,
      priority: form.priority,
      source: form.source,
      estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : null,
      currency: form.currency,
      probability: form.probability ? Number(form.probability) : undefined,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      expectedCloseAt: form.expectedCloseAt || null,
      nextActionAt: form.nextActionAt || null,
      nextActionNote: form.nextActionNote || null,
      notes: form.notes || null,
    });
  };

  if (isLoading || !lead) {
    return <div className="p-12 text-center text-xs text-gray-300">Loading…</div>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/leads')} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft size={14} />
          </button>
          <span className="text-xs font-semibold text-gray-900 truncate max-w-md">{lead.title}</span>
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium', STATUS_COLORS[lead.status])}>
            {lead.status.replace('_', ' ')}
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
            onClick={() => { if (confirm('Delete this lead?')) deleteMutation.mutate(); }}
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
              <Field label="Contact" value={
                <div className="text-[11px] flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">{lead.contact.displayName ?? lead.contact.phoneNumber}</div>
                    <div className="flex items-center gap-1 text-gray-400 mt-0.5">
                      <Phone size={9} /> {lead.contact.phoneNumber}
                    </div>
                  </div>
                  <button
                    onClick={() => setShowContactEdit(true)}
                    className="text-gray-400 hover:text-gray-700 p-0.5 rounded hover:bg-gray-100 shrink-0"
                    title="Edit contact"
                  >
                    <Pencil size={11} />
                  </button>
                </div>
              } />
              <Field label="Score" value={
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                    <div
                      className={cn('h-1.5 rounded-full', lead.score >= 70 ? 'bg-emerald-500' : lead.score >= 40 ? 'bg-gray-800' : 'bg-gray-300')}
                      style={{ width: `${lead.score}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold text-gray-700 w-6">{lead.score}</span>
                  <button onClick={() => recalcMutation.mutate()} className="text-gray-400 hover:text-gray-800" title="Recalculate">
                    <RefreshCw size={11} />
                  </button>
                </div>
              } />
              <Field label="Value" value={lead.estimatedValue ? `${lead.currency} ${lead.estimatedValue.toLocaleString()}` : '—'} />
              <Field label="Probability" value={`${lead.probability}%`} />
              <Field label="Priority" value={lead.priority} />
              <Field label="Source" value={lead.source} />
              <Field label="Tags" value={
                <div className="flex flex-wrap gap-1">
                  {lead.tags.length === 0 ? '—' : lead.tags.map((t) => (
                    <span key={t} className="text-[9px] bg-gray-50 text-gray-900 px-1.5 py-0.5 rounded">{t}</span>
                  ))}
                </div>
              } />
              <Field label="Expected close" value={lead.expectedCloseAt ? new Date(lead.expectedCloseAt).toLocaleDateString() : '—'} />
              <Field label="Next action" value={
                lead.nextActionAt ? (
                  <div>
                    <div className="text-[11px] text-gray-700">{new Date(lead.nextActionAt).toLocaleString()}</div>
                    {lead.nextActionNote && <div className="text-[10px] text-gray-400 mt-0.5">{lead.nextActionNote}</div>}
                  </div>
                ) : '—'
              } />
              <Field label="Assigned" value={
                lead.assignedAgent ? `${lead.assignedAgent.firstName} ${lead.assignedAgent.lastName}` : 'Unassigned'
              } />
              <Field label="Created" value={formatRelativeTime(lead.createdAt)} />

              {/* Score history mini-list */}
              {scoreHistory && scoreHistory.length > 0 && (
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-1">Score history</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {scoreHistory.slice(-5).reverse().map((e) => (
                      <div key={e.id} className="text-[10px] text-gray-500 flex items-center gap-1">
                        <span className={cn('font-mono w-8 text-right', e.delta > 0 ? 'text-emerald-600' : 'text-red-500')}>
                          {e.delta > 0 ? '+' : ''}{e.delta}
                        </span>
                        <span className="text-gray-300">→</span>
                        <span className="font-medium">{e.newScore}</span>
                        <span className="text-gray-400 truncate flex-1">{e.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <EditField label="Title">
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-gray-400" />
              </EditField>
              <EditField label="Priority">
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px] bg-white">
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </EditField>
              <EditField label="Source">
                <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px] bg-white">
                  {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </EditField>
              <EditField label="Value">
                <div className="flex gap-1">
                  <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="w-12 border border-gray-200 rounded px-2 py-1 text-[11px]" />
                  <input value={form.estimatedValue} onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })} type="number" className="flex-1 border border-gray-200 rounded px-2 py-1 text-[11px]" />
                </div>
              </EditField>
              <EditField label="Probability %">
                <input value={form.probability} onChange={(e) => setForm({ ...form, probability: e.target.value })} type="number" className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
              </EditField>
              <EditField label="Tags (comma)">
                <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
              </EditField>
              <EditField label="Expected close">
                <input type="date" value={form.expectedCloseAt} onChange={(e) => setForm({ ...form, expectedCloseAt: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
              </EditField>
              <EditField label="Next action">
                <input type="datetime-local" value={form.nextActionAt} onChange={(e) => setForm({ ...form, nextActionAt: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
              </EditField>
              <EditField label="Next action note">
                <input value={form.nextActionNote} onChange={(e) => setForm({ ...form, nextActionNote: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
              </EditField>
              <EditField label="Notes">
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={4} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px] resize-none" />
              </EditField>
            </>
          )}
        </aside>

        {/* Center: timeline */}
        <main className="flex-1 overflow-auto bg-white">
          <div className="p-4 space-y-3">
            {/* Note composer */}
            <div className="border border-gray-200 rounded-lg p-2">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note about this lead…"
                rows={2}
                className="w-full text-[11px] resize-none focus:outline-none placeholder:text-gray-300"
              />
              <div className="flex justify-end">
                <button
                  onClick={() => { if (noteText.trim()) noteMutation.mutate(noteText.trim()); }}
                  disabled={!noteText.trim() || noteMutation.isPending}
                  className="bg-gray-900 text-white px-2.5 py-0.5 rounded text-[10px] disabled:opacity-30 flex items-center gap-1"
                >
                  <StickyNote size={9} /> Add note
                </button>
              </div>
            </div>

            {/* Timeline */}
            <div className="space-y-2">
              {lead.activities.length === 0 ? (
                <p className="text-[11px] text-gray-300 text-center py-6">No activity yet.</p>
              ) : (
                lead.activities.map((a) => {
                  const isNote = a.type === 'NOTE_ADDED';
                  const isEditing = editingNoteId === a.id;
                  return (
                    <div key={a.id} className="group flex gap-2">
                      <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-gray-300 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                          <span className="font-mono uppercase tracking-wider">{a.type}</span>
                          <span>·</span>
                          <span>{a.actorType}</span>
                          <span>·</span>
                          <span>{formatRelativeTime(a.createdAt)}</span>
                          {isNote && !isEditing && (
                            <span className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => { setEditingNoteId(a.id); setEditingNoteText(a.body ?? ''); }}
                                className="text-gray-400 hover:text-gray-700 p-0.5 rounded hover:bg-gray-100"
                                title="Edit note"
                              >
                                <Pencil size={10} />
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm('Delete this note?')) deleteNoteMutation.mutate(a.id);
                                }}
                                className="text-gray-400 hover:text-red-500 p-0.5 rounded hover:bg-gray-100"
                                title="Delete note"
                              >
                                <Trash2 size={10} />
                              </button>
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-800 mt-0.5">{a.title}</div>
                        {isEditing ? (
                          <div className="mt-1">
                            <textarea
                              value={editingNoteText}
                              onChange={(e) => setEditingNoteText(e.target.value)}
                              rows={3}
                              className="w-full border border-gray-200 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-gray-400 resize-none bg-white"
                              autoFocus
                            />
                            <div className="flex items-center gap-1.5 mt-1">
                              <button
                                onClick={() => {
                                  const next = editingNoteText.trim();
                                  if (!next || next === (a.body ?? '')) {
                                    setEditingNoteId(null);
                                    setEditingNoteText('');
                                    return;
                                  }
                                  updateNoteMutation.mutate({ activityId: a.id, body: next });
                                }}
                                disabled={updateNoteMutation.isPending || !editingNoteText.trim()}
                                className="flex items-center gap-0.5 bg-gray-900 text-white px-2 py-0.5 rounded text-[10px] hover:bg-gray-800 disabled:opacity-30"
                              >
                                <Check size={9} /> Save
                              </button>
                              <button
                                onClick={() => { setEditingNoteId(null); setEditingNoteText(''); }}
                                className="flex items-center gap-0.5 text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded text-[10px]"
                              >
                                <X size={9} /> Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          a.body && <div className="text-[10px] text-gray-500 mt-0.5 whitespace-pre-wrap">{a.body}</div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </main>

        {/* Right: actions + deals */}
        <aside className="w-60 border-l border-gray-200 bg-white overflow-auto p-3 space-y-3 shrink-0">
          <div>
            <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-1.5">Quick actions</p>
            <div className="space-y-1">
              {lead.status !== 'QUALIFIED' && lead.status !== 'WON' && (
                <button
                  onClick={() => statusMutation.mutate('QUALIFIED')}
                  className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-gray-200 text-gray-900 hover:bg-gray-50"
                >
                  <CheckCircle size={11} /> Qualify
                </button>
              )}
              {lead.status !== 'WON' && (
                <button
                  onClick={() => convertMutation.mutate()}
                  className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                >
                  <ArrowRight size={11} /> Convert to deal
                </button>
              )}
              {lead.status !== 'WON' && (
                <button
                  onClick={() => statusMutation.mutate('WON')}
                  className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                >
                  <Award size={11} /> Mark won
                </button>
              )}
              {lead.status !== 'LOST' && lead.status !== 'DISQUALIFIED' && (
                <button
                  onClick={() => {
                    const reason = prompt('Lost reason?');
                    if (reason) {
                      api.post(`/leads/${id}/status`, { status: 'LOST', reason }).then(() => invalidate());
                    }
                  }}
                  className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-red-200 text-red-700 hover:bg-red-50"
                >
                  <XCircle size={11} /> Mark lost
                </button>
              )}
            </div>
          </div>

          <div>
            <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-1.5">Linked deals</p>
            {lead.deals.length === 0 ? (
              <p className="text-[10px] text-gray-300">None yet.</p>
            ) : (
              <div className="space-y-1">
                {lead.deals.map((d) => (
                  <div key={d.id} className="text-[11px] border border-gray-200 rounded px-2 py-1">
                    <div className="font-medium text-gray-900 truncate">{d.title}</div>
                    <div className="flex items-center justify-between text-[10px] text-gray-400 mt-0.5">
                      <span>{d.stage}</span>
                      <span>{d.currency} {d.value.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {showContactEdit && (
        <ContactEditModal
          contactId={lead.contact.id}
          onClose={() => setShowContactEdit(false)}
          onSaved={() => {
            setShowContactEdit(false);
            invalidate();
            toast.success('Contact updated');
          }}
        />
      )}
    </div>
  );
}

function ContactEditModal({
  contactId,
  onClose,
  onSaved,
}: {
  contactId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({
    displayName: '', firstName: '', lastName: '', phoneNumber: '',
    email: '', companyName: '', jobTitle: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<{ data: Record<string, string | undefined> }>(`/contacts/${contactId}`)
      .then((r) => {
        if (cancelled) return;
        const c = r.data.data || {};
        setForm({
          displayName: c.displayName ?? '',
          firstName: c.firstName ?? '',
          lastName: c.lastName ?? '',
          phoneNumber: c.phoneNumber ?? '',
          email: c.email ?? '',
          companyName: c.companyName ?? '',
          jobTitle: c.jobTitle ?? '',
        });
      })
      .catch(() => toast.error('Failed to load contact'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [contactId]);

  // Reject letters in phone — matches backend guard.
  const phoneValid = (() => {
    const raw = form.phoneNumber.trim();
    if (!raw) return false;
    if (/[A-Za-z]/.test(raw)) return false;
    return raw.replace(/\D/g, '').length >= 7;
  })();

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/contacts/${contactId}`, {
        displayName: form.displayName || null,
        firstName: form.firstName || null,
        lastName: form.lastName || null,
        phoneNumber: form.phoneNumber,
        email: form.email || null,
        companyName: form.companyName || null,
        jobTitle: form.jobTitle || null,
      });
      onSaved();
    } catch {
      toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-gray-200 px-4 py-2.5 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-900">Edit contact</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        </div>
        {loading ? (
          <div className="p-6 text-center text-[11px] text-gray-300">Loading…</div>
        ) : (
          <div className="p-4 space-y-2">
            {([
              { key: 'displayName', label: 'Display name' },
              { key: 'firstName', label: 'First name' },
              { key: 'lastName', label: 'Last name' },
              { key: 'phoneNumber', label: 'Phone', type: 'tel' },
              { key: 'email', label: 'Email', type: 'email' },
              { key: 'companyName', label: 'Company' },
              { key: 'jobTitle', label: 'Job title' },
            ] as Array<{ key: string; label: string; type?: string }>).map(({ key, label, type }) => (
              <div key={key}>
                <label className="text-[9px] uppercase tracking-widest text-gray-400 block mb-0.5">{label}</label>
                <input
                  value={form[key] ?? ''}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  type={type ?? 'text'}
                  className={cn(
                    'w-full border rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1',
                    key === 'phoneNumber' && form.phoneNumber.length > 0 && !phoneValid
                      ? 'border-red-300 focus:ring-red-400'
                      : 'border-gray-200 focus:ring-gray-400',
                  )}
                />
                {key === 'phoneNumber' && form.phoneNumber.length > 0 && !phoneValid && (
                  <span className="text-[10px] text-red-500 mt-0.5 block">Digits only — letters are not allowed.</span>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="border-t border-gray-200 px-4 py-2.5 flex justify-end gap-2">
          <button onClick={onClose} className="text-[11px] text-gray-500 hover:text-gray-700 px-2 py-1">Cancel</button>
          <button
            onClick={save}
            disabled={loading || saving || !phoneValid}
            className="text-[11px] bg-gray-900 text-white px-3 py-1 rounded hover:bg-gray-800 disabled:opacity-30 flex items-center gap-1"
          >
            <Save size={10} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
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
