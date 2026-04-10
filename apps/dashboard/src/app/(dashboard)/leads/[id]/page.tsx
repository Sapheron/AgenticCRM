'use client';

/**
 * Lead detail page — three-column Linear-style layout matching contacts/[id].
 *
 *  Left:   Info panel (status, score, value, contact, edit/save form)
 *  Center: Activity timeline + inline note composer
 *  Right:  Linked deals + quick actions (qualify, convert, won/lost)
 */

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { toast } from 'sonner';
import { cn, formatRelativeTime } from '@/lib/utils';
import {
  ArrowLeft, Save, Phone, Award,
  StickyNote, CheckCircle, XCircle, ArrowRight, RefreshCw, Trash2,
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
            <button onClick={startEdit} className="text-[11px] text-violet-600 hover:text-violet-700">Edit</button>
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
                <div className="text-[11px]">
                  <div className="font-medium text-gray-900">{lead.contact.displayName ?? lead.contact.phoneNumber}</div>
                  <div className="flex items-center gap-1 text-gray-400 mt-0.5">
                    <Phone size={9} /> {lead.contact.phoneNumber}
                  </div>
                </div>
              } />
              <Field label="Score" value={
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                    <div
                      className={cn('h-1.5 rounded-full', lead.score >= 70 ? 'bg-emerald-500' : lead.score >= 40 ? 'bg-violet-500' : 'bg-gray-300')}
                      style={{ width: `${lead.score}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold text-gray-700 w-6">{lead.score}</span>
                  <button onClick={() => recalcMutation.mutate()} className="text-gray-400 hover:text-violet-500" title="Recalculate">
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
                    <span key={t} className="text-[9px] bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded">{t}</span>
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
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-violet-400" />
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
                lead.activities.map((a) => (
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
                  className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-violet-200 text-violet-700 hover:bg-violet-50"
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
