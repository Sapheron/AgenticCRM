'use client';

/**
 * Deal detail page — three-column Linear-style layout matching /leads/[id].
 *
 *  Left:   info panel (stage, value, probability, contact, edit form)
 *  Center: tabs — activity timeline + line items + linked items
 *  Right:  quick actions (move stage, mark won/lost, reopen, delete)
 */

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { toast } from 'sonner';
import { cn, formatRelativeTime } from '@/lib/utils';
import {
  ArrowLeft, Save, Phone, Award, StickyNote, CheckCircle, XCircle,
  ArrowRight, RefreshCw, Trash2, Plus, X,
} from 'lucide-react';
import { DEAL_STAGE_ORDER, DEAL_STAGE_LABELS } from '@wacrm/shared';
import { type DealStage, type DealSource, type DealPriority } from '../page';

interface DealDetail {
  id: string;
  title: string;
  stage: DealStage;
  source: DealSource;
  priority: DealPriority;
  value: number;
  currency: string;
  probability: number;
  weightedValue?: number;
  tags: string[];
  notes?: string;
  expectedCloseAt?: string;
  nextActionAt?: string;
  nextActionNote?: string;
  qualifiedAt?: string;
  proposalSentAt?: string;
  wonAt?: string;
  lostAt?: string;
  lostReason?: string;
  lostReasonCode?: string;
  salesCycleDays?: number;
  createdAt: string;
  updatedAt: string;
  contact: { id: string; displayName?: string; phoneNumber: string };
  assignedAgent?: { id: string; firstName: string; lastName: string; avatarUrl?: string };
  lead?: { id: string; title: string; status: string };
  payments: Array<{ id: string; amount: number; currency: string; status: string; createdAt: string }>;
  tasks: Array<{ id: string; title: string; status: string }>;
  lineItems: LineItem[];
  activities: Array<TimelineActivity>;
}

interface LineItem {
  id: string;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  total: number;
  position: number;
}

interface TimelineActivity {
  id: string;
  type: string;
  actorType: string;
  title: string;
  body?: string;
  createdAt: string;
}

const PRIORITIES: DealPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const SOURCES: DealSource[] = ['LEAD_CONVERSION', 'WHATSAPP', 'MANUAL', 'AI_CHAT', 'REFERRAL', 'CAMPAIGN', 'WEBSITE', 'IMPORT', 'OTHER'];
const LOSS_REASONS = ['PRICE', 'COMPETITOR', 'TIMING', 'NO_BUDGET', 'NO_DECISION', 'WRONG_FIT', 'GHOSTED', 'OTHER'];

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'timeline' | 'lineItems' | 'linked'>('timeline');
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [noteText, setNoteText] = useState('');
  const [showLineItemForm, setShowLineItemForm] = useState(false);

  const { data: deal, isLoading } = useQuery({
    queryKey: ['deal', id],
    queryFn: async () => {
      const r = await api.get<{ data: DealDetail }>(`/deals/${id}`);
      return r.data.data;
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['deal', id] });
    void qc.invalidateQueries({ queryKey: ['deals'] });
    void qc.invalidateQueries({ queryKey: ['deal-forecast'] });
  };

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/deals/${id}`, data),
    onSuccess: () => { invalidate(); setEditMode(false); toast.success('Saved'); },
    onError: () => toast.error('Save failed'),
  });

  const stageMutation = useMutation({
    mutationFn: (body: { stage: DealStage; lossReason?: string }) =>
      api.post(`/deals/${id}/stage`, body),
    onSuccess: () => { invalidate(); toast.success('Stage updated'); },
    onError: (err: unknown) => {
      const msg = (err && typeof err === 'object' && 'response' in err
        ? ((err as { response?: { data?: { message?: string } } }).response?.data?.message)
        : null) ?? 'Stage change failed';
      toast.error(msg);
    },
  });

  const noteMutation = useMutation({
    mutationFn: (body: string) => api.post(`/deals/${id}/notes`, { body }),
    onSuccess: () => { invalidate(); setNoteText(''); toast.success('Note added'); },
  });

  const reopenMutation = useMutation({
    mutationFn: () => api.post(`/deals/${id}/reopen`, { reason: 'manual reopen from dashboard' }),
    onSuccess: () => { invalidate(); toast.success('Deal reopened'); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/deals/${id}`),
    onSuccess: () => { toast.success('Deleted'); router.push('/deals'); },
  });

  const addLineItemMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/deals/${id}/line-items`, body),
    onSuccess: () => { invalidate(); setShowLineItemForm(false); toast.success('Line item added'); },
  });

  const removeLineItemMutation = useMutation({
    mutationFn: (itemId: string) => api.delete(`/deals/${id}/line-items/${itemId}`),
    onSuccess: () => { invalidate(); toast.success('Removed'); },
  });

  const startEdit = () => {
    if (!deal) return;
    setForm({
      title: deal.title,
      value: deal.value.toString(),
      currency: deal.currency,
      probability: deal.probability.toString(),
      priority: deal.priority,
      source: deal.source,
      tags: deal.tags.join(', '),
      expectedCloseAt: deal.expectedCloseAt?.slice(0, 10) ?? '',
      nextActionAt: deal.nextActionAt?.slice(0, 16) ?? '',
      nextActionNote: deal.nextActionNote ?? '',
    });
    setEditMode(true);
  };

  const saveEdit = () => {
    updateMutation.mutate({
      title: form.title,
      value: form.value ? Number(form.value) : undefined,
      currency: form.currency,
      probability: form.probability ? Number(form.probability) : undefined,
      priority: form.priority,
      source: form.source,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      expectedCloseAt: form.expectedCloseAt || null,
      nextActionAt: form.nextActionAt || null,
      nextActionNote: form.nextActionNote || null,
    });
  };

  const handleMarkLost = () => {
    const reason = prompt(`Loss reason? Pick one of: ${LOSS_REASONS.join(', ')}`);
    if (!reason) return;
    if (!LOSS_REASONS.includes(reason.toUpperCase())) {
      toast.error(`Invalid reason. Use one of: ${LOSS_REASONS.join(', ')}`);
      return;
    }
    stageMutation.mutate({ stage: 'LOST', lossReason: reason.toUpperCase() });
  };

  if (isLoading || !deal) {
    return <div className="p-12 text-center text-xs text-gray-300">Loading…</div>;
  }

  const isClosed = deal.stage === 'WON' || deal.stage === 'LOST';
  const lineItemsTotal = deal.lineItems.reduce((a, i) => a + i.total, 0);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/deals')} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft size={14} />
          </button>
          <span className="text-xs font-semibold text-gray-900 truncate max-w-md">{deal.title}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-50 text-gray-600 font-medium">
            {DEAL_STAGE_LABELS[deal.stage]}
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
            onClick={() => { if (confirm('Delete this deal?')) deleteMutation.mutate(); }}
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
                  <div className="font-medium text-gray-900">{deal.contact.displayName ?? deal.contact.phoneNumber}</div>
                  <div className="flex items-center gap-1 text-gray-400 mt-0.5">
                    <Phone size={9} /> {deal.contact.phoneNumber}
                  </div>
                </div>
              } />
              {deal.lead && (
                <Field label="Source lead" value={
                  <span className="text-[11px] text-violet-600">{deal.lead.title} ({deal.lead.status})</span>
                } />
              )}
              <Field label="Value" value={
                <span className="text-[11px] font-semibold text-gray-900">{deal.currency} {deal.value.toLocaleString()}</span>
              } />
              <Field label="Probability" value={
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                    <div
                      className={cn('h-1.5 rounded-full', deal.probability >= 70 ? 'bg-emerald-500' : deal.probability >= 40 ? 'bg-violet-500' : 'bg-gray-300')}
                      style={{ width: `${deal.probability}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold text-gray-700 w-8">{deal.probability}%</span>
                </div>
              } />
              <Field label="Weighted" value={
                <span className="text-[11px] text-gray-700">{deal.currency} {Math.round((deal.weightedValue ?? deal.value * (deal.probability / 100))).toLocaleString()}</span>
              } />
              <Field label="Priority" value={deal.priority} />
              <Field label="Source" value={deal.source} />
              <Field label="Tags" value={
                <div className="flex flex-wrap gap-1">
                  {deal.tags.length === 0 ? '—' : deal.tags.map((t) => (
                    <span key={t} className="text-[9px] bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded">{t}</span>
                  ))}
                </div>
              } />
              <Field label="Expected close" value={deal.expectedCloseAt ? new Date(deal.expectedCloseAt).toLocaleDateString() : '—'} />
              <Field label="Next action" value={
                deal.nextActionAt ? (
                  <div>
                    <div className="text-[11px] text-gray-700">{new Date(deal.nextActionAt).toLocaleString()}</div>
                    {deal.nextActionNote && <div className="text-[10px] text-gray-400 mt-0.5">{deal.nextActionNote}</div>}
                  </div>
                ) : '—'
              } />
              <Field label="Assigned" value={
                deal.assignedAgent ? `${deal.assignedAgent.firstName} ${deal.assignedAgent.lastName}` : 'Unassigned'
              } />
              {deal.salesCycleDays !== null && deal.salesCycleDays !== undefined && (
                <Field label="Sales cycle" value={`${deal.salesCycleDays} days`} />
              )}
              {deal.lostReasonCode && (
                <Field label="Lost reason" value={
                  <div>
                    <span className="text-[10px] bg-red-50 text-red-700 px-1.5 py-0.5 rounded">{deal.lostReasonCode}</span>
                    {deal.lostReason && <div className="text-[10px] text-gray-400 mt-0.5">{deal.lostReason}</div>}
                  </div>
                } />
              )}
              <Field label="Created" value={formatRelativeTime(deal.createdAt)} />
            </>
          ) : (
            <>
              <EditField label="Title">
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-violet-400" />
              </EditField>
              <EditField label="Value">
                <div className="flex gap-1">
                  <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="w-12 border border-gray-200 rounded px-2 py-1 text-[11px]" />
                  <input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} type="number" className="flex-1 border border-gray-200 rounded px-2 py-1 text-[11px]" />
                </div>
              </EditField>
              <EditField label="Probability %">
                <input value={form.probability} onChange={(e) => setForm({ ...form, probability: e.target.value })} type="number" className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
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
            </>
          )}
        </aside>

        {/* Center: tabbed content */}
        <main className="flex-1 overflow-auto bg-white">
          <div className="border-b border-gray-100 px-4 flex items-center gap-3">
            {(['timeline', 'lineItems', 'linked'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'text-[11px] py-2 border-b-2 transition',
                  tab === t ? 'border-violet-500 text-violet-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700',
                )}
              >
                {t === 'timeline' ? 'Activity' : t === 'lineItems' ? `Line items (${deal.lineItems.length})` : `Linked (${deal.payments.length + deal.tasks.length})`}
              </button>
            ))}
          </div>

          {tab === 'timeline' && (
            <div className="p-4 space-y-3">
              <div className="border border-gray-200 rounded-lg p-2">
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add a note about this deal…"
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
              <div className="space-y-2">
                {deal.activities.length === 0 ? (
                  <p className="text-[11px] text-gray-300 text-center py-6">No activity yet.</p>
                ) : (
                  deal.activities.map((a) => (
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
          )}

          {tab === 'lineItems' && (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-gray-500">
                  Items total: <span className="font-semibold text-gray-900">{deal.currency} {lineItemsTotal.toLocaleString()}</span>
                </p>
                <button
                  onClick={() => setShowLineItemForm(true)}
                  className="text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded flex items-center gap-1"
                >
                  <Plus size={9} /> Add item
                </button>
              </div>
              {showLineItemForm && (
                <LineItemForm
                  onCancel={() => setShowLineItemForm(false)}
                  onSubmit={(body) => addLineItemMutation.mutate(body)}
                  pending={addLineItemMutation.isPending}
                />
              )}
              {deal.lineItems.length === 0 ? (
                <p className="text-[11px] text-gray-300 text-center py-6">No line items yet.</p>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50/80 border-b border-gray-200">
                    <tr>
                      {['Name', 'Qty', 'Unit', 'Disc%', 'Tax%', 'Total', ''].map((h) => (
                        <th key={h} className="text-left px-2 py-1 text-[9px] font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {deal.lineItems.map((i) => (
                      <tr key={i.id} className="hover:bg-gray-50/50">
                        <td className="px-2 py-1.5">
                          <div className="text-[11px] font-medium text-gray-900">{i.name}</div>
                          {i.description && <div className="text-[10px] text-gray-400">{i.description}</div>}
                        </td>
                        <td className="px-2 py-1.5 text-[11px] text-gray-600">{i.quantity}</td>
                        <td className="px-2 py-1.5 text-[11px] text-gray-600">{i.unitPrice}</td>
                        <td className="px-2 py-1.5 text-[11px] text-gray-600">{i.discount}%</td>
                        <td className="px-2 py-1.5 text-[11px] text-gray-600">{i.taxRate}%</td>
                        <td className="px-2 py-1.5 text-[11px] font-semibold text-gray-900">{i.total}</td>
                        <td className="px-2 py-1.5">
                          <button
                            onClick={() => removeLineItemMutation.mutate(i.id)}
                            className="text-gray-400 hover:text-red-500"
                          >
                            <X size={11} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'linked' && (
            <div className="p-4 space-y-4">
              <div>
                <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-1.5">Payments</p>
                {deal.payments.length === 0 ? (
                  <p className="text-[10px] text-gray-300">None.</p>
                ) : (
                  <div className="space-y-1">
                    {deal.payments.map((p) => (
                      <div key={p.id} className="text-[11px] border border-gray-200 rounded px-2 py-1 flex items-center justify-between">
                        <span>{p.currency} {p.amount.toLocaleString()}</span>
                        <span className="text-[10px] text-gray-400">{p.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-1.5">Tasks</p>
                {deal.tasks.length === 0 ? (
                  <p className="text-[10px] text-gray-300">None.</p>
                ) : (
                  <div className="space-y-1">
                    {deal.tasks.map((t) => (
                      <div key={t.id} className="text-[11px] border border-gray-200 rounded px-2 py-1 flex items-center justify-between">
                        <span className="truncate">{t.title}</span>
                        <span className="text-[10px] text-gray-400 ml-2">{t.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {/* Right: actions */}
        <aside className="w-60 border-l border-gray-200 bg-white overflow-auto p-3 space-y-3 shrink-0">
          <div>
            <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-1.5">Move stage</p>
            <select
              value={deal.stage}
              onChange={(e) => stageMutation.mutate({ stage: e.target.value as DealStage })}
              disabled={isClosed}
              className="w-full text-[11px] border border-gray-200 rounded px-2 py-1.5 bg-white disabled:opacity-50"
            >
              {DEAL_STAGE_ORDER.map((s) => (
                <option key={s} value={s}>{DEAL_STAGE_LABELS[s]}</option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-1.5">Quick actions</p>
            <div className="space-y-1">
              {!isClosed && deal.stage !== 'QUALIFIED' && (
                <button
                  onClick={() => stageMutation.mutate({ stage: 'QUALIFIED' })}
                  className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-violet-200 text-violet-700 hover:bg-violet-50"
                >
                  <CheckCircle size={11} /> Qualify
                </button>
              )}
              {!isClosed && deal.stage !== 'PROPOSAL' && (
                <button
                  onClick={() => stageMutation.mutate({ stage: 'PROPOSAL' })}
                  className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-orange-200 text-orange-700 hover:bg-orange-50"
                >
                  <ArrowRight size={11} /> Send proposal
                </button>
              )}
              {!isClosed && (
                <button
                  onClick={() => stageMutation.mutate({ stage: 'WON' })}
                  className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                >
                  <Award size={11} /> Mark won
                </button>
              )}
              {!isClosed && (
                <button
                  onClick={handleMarkLost}
                  className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-red-200 text-red-700 hover:bg-red-50"
                >
                  <XCircle size={11} /> Mark lost
                </button>
              )}
              {isClosed && (
                <button
                  onClick={() => reopenMutation.mutate()}
                  className="w-full text-left text-[11px] flex items-center gap-2 px-2 py-1.5 rounded border border-blue-200 text-blue-700 hover:bg-blue-50"
                >
                  <RefreshCw size={11} /> Reopen
                </button>
              )}
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

function LineItemForm({
  onCancel,
  onSubmit,
  pending,
}: {
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [discount, setDiscount] = useState('0');
  const [taxRate, setTaxRate] = useState('0');

  return (
    <div className="border border-violet-200 bg-violet-50/30 rounded p-2 space-y-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
      <div className="grid grid-cols-4 gap-1.5">
        <input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" placeholder="Qty" className="border border-gray-200 rounded px-2 py-1 text-[11px]" />
        <input value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} type="number" placeholder="Unit price" className="border border-gray-200 rounded px-2 py-1 text-[11px]" />
        <input value={discount} onChange={(e) => setDiscount(e.target.value)} type="number" placeholder="Disc %" className="border border-gray-200 rounded px-2 py-1 text-[11px]" />
        <input value={taxRate} onChange={(e) => setTaxRate(e.target.value)} type="number" placeholder="Tax %" className="border border-gray-200 rounded px-2 py-1 text-[11px]" />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-[10px] text-gray-500 px-2">Cancel</button>
        <button
          onClick={() => onSubmit({ name, quantity: Number(quantity), unitPrice: Number(unitPrice), discount: Number(discount), taxRate: Number(taxRate) })}
          disabled={!name || !unitPrice || pending}
          className="text-[10px] bg-gray-900 text-white px-2 py-1 rounded disabled:opacity-30"
        >
          {pending ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  );
}
