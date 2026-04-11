'use client';

/**
 * Form detail — 3-column Linear layout matching /leads/[id], /deals/[id],
 * and /campaigns/[id].
 *
 * Left panel:   metadata, publishing settings, auto-actions config
 * Center panel: tab switcher — Fields builder / Submissions / Activity / Notes
 * Right panel:  contextual quick actions + public URL copy + webhook copy
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
  Archive,
  Copy,
  Trash2,
  X,
  Plus,
  Check,
  AlertTriangle,
  Edit3,
  MessageSquare,
  FileText,
  RotateCcw,
  Globe,
  Webhook,
} from 'lucide-react';
import { toast } from 'sonner';

type FormStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
type FormFieldType =
  | 'text'
  | 'email'
  | 'phone'
  | 'number'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'url';

interface FormField {
  key: string;
  type: FormFieldType;
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
}

interface Form {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: FormStatus;
  fields: FormField[];
  isPublic: boolean;
  requireCaptcha: boolean;
  rateLimitPerHour: number;
  autoCreateLead: boolean;
  autoLeadSource: string | null;
  autoLeadTitle: string | null;
  autoEnrollSequenceId: string | null;
  autoAssignUserId: string | null;
  autoTagContact: string[];
  webhookForwardUrl: string | null;
  submitCount: number;
  convertedCount: number;
  spamCount: number;
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
  }>;
}

interface SubmissionRow {
  id: string;
  status: string;
  data: Record<string, unknown>;
  leadId: string | null;
  contactId: string | null;
  errorReason: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<FormStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-500',
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  PAUSED: 'bg-amber-50 text-amber-600',
  ARCHIVED: 'bg-gray-50 text-gray-400',
};

const FIELD_TYPES: FormFieldType[] = [
  'text',
  'email',
  'phone',
  'number',
  'textarea',
  'select',
  'radio',
  'checkbox',
  'date',
  'url',
];

export default function FormDetailPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const id = params.id as string;

  const [tab, setTab] = useState<'fields' | 'submissions' | 'activity' | 'notes'>('fields');
  const [showAddField, setShowAddField] = useState(false);
  const [submissionStatusFilter, setSubmissionStatusFilter] = useState('');
  const [noteDraft, setNoteDraft] = useState('');

  const { data: form, isLoading } = useQuery({
    queryKey: ['form', id],
    queryFn: async () => {
      const r = await api.get<{ data: Form }>(`/forms/${id}`);
      return r.data.data;
    },
  });

  const { data: submissions } = useQuery({
    queryKey: ['form-submissions', id, submissionStatusFilter],
    enabled: tab === 'submissions',
    queryFn: async () => {
      const q = submissionStatusFilter ? `?status=${submissionStatusFilter}` : '';
      const r = await api.get<{ data: { items: SubmissionRow[]; total: number } }>(
        `/forms/${id}/submissions${q}`,
      );
      return r.data.data;
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['form', id] });
  };
  const onErr = (err: unknown) => {
    const msg =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : null;
    toast.error(msg ?? 'Failed');
  };

  const publishM = useMutation({
    mutationFn: () => api.post(`/forms/${id}/publish`),
    onSuccess: () => {
      invalidate();
      toast.success('Published');
    },
    onError: onErr,
  });
  const unpublishM = useMutation({
    mutationFn: () => api.post(`/forms/${id}/unpublish`),
    onSuccess: () => {
      invalidate();
      toast.success('Unpublished');
    },
    onError: onErr,
  });
  const archiveM = useMutation({
    mutationFn: () => api.post(`/forms/${id}/archive`),
    onSuccess: () => {
      invalidate();
      toast.success('Archived');
    },
    onError: onErr,
  });
  const restoreM = useMutation({
    mutationFn: () => api.post(`/forms/${id}/restore`),
    onSuccess: () => {
      invalidate();
      toast.success('Restored');
    },
    onError: onErr,
  });
  const duplicateM = useMutation({
    mutationFn: () => api.post<{ data: Form }>(`/forms/${id}/duplicate`),
    onSuccess: (r) => {
      toast.success('Duplicated');
      router.push(`/forms/${r.data.data.id}`);
    },
    onError: onErr,
  });
  const deleteM = useMutation({
    mutationFn: () => api.delete(`/forms/${id}`),
    onSuccess: () => {
      toast.success('Deleted');
      router.push('/forms');
    },
    onError: onErr,
  });

  const removeFieldM = useMutation({
    mutationFn: (key: string) => api.delete(`/forms/${id}/fields/${key}`),
    onSuccess: () => {
      invalidate();
      toast.success('Field removed');
    },
    onError: onErr,
  });

  const togglePublicM = useMutation({
    mutationFn: (isPublic: boolean) => api.patch(`/forms/${id}`, { isPublic }),
    onSuccess: () => {
      invalidate();
      toast.success('Updated');
    },
    onError: onErr,
  });

  const toggleAutoLeadM = useMutation({
    mutationFn: (autoCreateLead: boolean) =>
      api.post(`/forms/${id}/auto-actions`, { autoCreateLead }),
    onSuccess: () => {
      invalidate();
      toast.success('Auto-actions updated');
    },
    onError: onErr,
  });

  const addNoteM = useMutation({
    mutationFn: () => api.post(`/forms/${id}/notes`, { body: noteDraft }),
    onSuccess: () => {
      invalidate();
      setNoteDraft('');
      toast.success('Note added');
    },
  });

  const convertSubmissionM = useMutation({
    mutationFn: (sid: string) =>
      api.post(`/forms/${id}/submissions/${sid}/convert`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['form-submissions', id] });
      toast.success('Converted');
    },
    onError: onErr,
  });

  const markSpamM = useMutation({
    mutationFn: (sid: string) =>
      api.post(`/forms/${id}/submissions/${sid}/mark-spam`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['form-submissions', id] });
      void qc.invalidateQueries({ queryKey: ['form', id] });
      toast.success('Marked as spam');
    },
  });

  const publicUrl = useMemo(() => {
    if (!form) return null;
    if (typeof window === 'undefined') return null;
    return `${window.location.origin}/public/forms/${form.slug}`;
  }, [form]);

  const webhookUrl = useMemo(() => {
    if (!form) return null;
    if (typeof window === 'undefined') return null;
    const apiOrigin = window.location.origin.replace(/:\d+$/, ':3000');
    return `${apiOrigin}/api/webhooks/forms/${form.slug}`;
  }, [form]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-300 text-xs">Loading…</p>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-300 text-xs">Form not found</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 border-b border-gray-200 px-4 flex items-center gap-3 shrink-0 bg-white">
        <Link href="/forms" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={14} />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xs font-semibold text-gray-900 truncate">{form.name}</h1>
          <p className="text-[10px] text-gray-400 truncate">
            /{form.slug} {form.description ? `· ${form.description}` : ''}
          </p>
        </div>
        <span className={cn('text-[10px] px-2 py-0.5 rounded font-medium', STATUS_COLORS[form.status])}>
          {form.status}
        </span>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Left panel */}
        <aside className="w-64 border-r border-gray-200 bg-white overflow-auto shrink-0">
          <div className="p-3 space-y-4">
            <Section title="Publishing">
              <Row label="Public" value={
                <button
                  onClick={() => togglePublicM.mutate(!form.isPublic)}
                  className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded',
                    form.isPublic ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500',
                  )}
                >
                  {form.isPublic ? 'Yes' : 'No'}
                </button>
              } />
              <Row label="Rate limit" value={`${form.rateLimitPerHour}/hour`} />
              <Row label="Captcha" value={form.requireCaptcha ? 'On' : 'Off'} />
            </Section>

            <Section title="Auto-actions">
              <Row
                label="Create lead"
                value={
                  <button
                    onClick={() => toggleAutoLeadM.mutate(!form.autoCreateLead)}
                    className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded',
                      form.autoCreateLead
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-gray-100 text-gray-500',
                    )}
                  >
                    {form.autoCreateLead ? 'On' : 'Off'}
                  </button>
                }
              />
              {form.autoLeadSource && <Row label="Lead source" value={form.autoLeadSource} />}
              {form.autoTagContact.length > 0 && (
                <div className="text-[10px] text-gray-500 mt-1">
                  Tags:{' '}
                  <span className="flex flex-wrap gap-1 mt-0.5">
                    {form.autoTagContact.map((t) => (
                      <span
                        key={t}
                        className="text-[9px] bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded"
                      >
                        {t}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {form.autoEnrollSequenceId && (
                <Row label="Enrol seq" value={<code className="text-[9px]">{form.autoEnrollSequenceId.slice(0, 8)}…</code>} />
              )}
            </Section>

            <Section title="Counters">
              <Row label="Submissions" value={form.submitCount} />
              <Row label="Converted" value={form.convertedCount} />
              <Row label="Spam" value={form.spamCount} />
            </Section>

            <Section title="Meta">
              <Row label="Priority" value={form.priority} />
              {form.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {form.tags.map((t) => (
                    <span key={t} className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <Row label="Created" value={formatRelativeTime(form.createdAt)} />
              <Row label="Updated" value={formatRelativeTime(form.updatedAt)} />
            </Section>
          </div>
        </aside>

        {/* Center panel */}
        <main className="flex-1 flex flex-col min-w-0 bg-white">
          <div className="h-9 border-b border-gray-200 px-3 flex items-center gap-4 shrink-0">
            {(['fields', 'submissions', 'activity', 'notes'] as const).map((t) => (
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
                {t === 'fields' && form.fields.length > 0 && (
                  <span className="ml-1 text-[9px] text-gray-400">({form.fields.length})</span>
                )}
                {t === 'submissions' && form.submitCount > 0 && (
                  <span className="ml-1 text-[9px] text-gray-400">({form.submitCount})</span>
                )}
              </button>
            ))}
          </div>

          {tab === 'fields' && (
            <div className="flex-1 overflow-auto p-3">
              {form.fields.length === 0 ? (
                <div className="text-center py-12 text-gray-300">
                  <FileText size={24} className="mx-auto mb-2" />
                  <p className="text-xs">No fields yet</p>
                  <p className="text-[10px] mt-1">Add at least one field before publishing</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {form.fields.map((f, i) => (
                    <div
                      key={f.key}
                      className="border border-gray-200 rounded p-2.5 hover:border-violet-200 group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] text-gray-400">#{i + 1}</span>
                            <span className="text-[11px] font-medium text-gray-900">
                              {f.label}
                            </span>
                            {f.required && (
                              <span className="text-[9px] bg-red-50 text-red-600 px-1 rounded">
                                required
                              </span>
                            )}
                            <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 rounded">
                              {f.type}
                            </span>
                          </div>
                          <div className="text-[10px] text-gray-400 mt-0.5">
                            <code>{f.key}</code>
                            {f.placeholder && <span className="ml-2">&ldquo;{f.placeholder}&rdquo;</span>}
                          </div>
                          {f.options && f.options.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {f.options.map((o) => (
                                <span
                                  key={o.value}
                                  className="text-[9px] bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded"
                                >
                                  {o.label}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            if (confirm(`Remove field "${f.label}"?`)) removeFieldM.mutate(f.key);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {form.status !== 'ARCHIVED' && (
                <button
                  onClick={() => setShowAddField(true)}
                  className="mt-3 w-full border border-dashed border-gray-200 rounded py-2 text-[11px] text-gray-500 hover:text-violet-600 hover:border-violet-300 flex items-center justify-center gap-1"
                >
                  <Plus size={11} /> Add field
                </button>
              )}
            </div>
          )}

          {tab === 'submissions' && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="h-9 border-b border-gray-100 px-3 flex items-center gap-2 shrink-0">
                <select
                  value={submissionStatusFilter}
                  onChange={(e) => setSubmissionStatusFilter(e.target.value)}
                  className="text-[11px] border border-gray-200 rounded px-2 py-0.5"
                >
                  <option value="">All statuses</option>
                  <option value="RECEIVED">Received</option>
                  <option value="CONVERTED">Converted</option>
                  <option value="SPAM">Spam</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
                <span className="text-[10px] text-gray-400 ml-auto">
                  {submissions?.total ?? 0} submission{submissions?.total === 1 ? '' : 's'}
                </span>
              </div>
              <div className="flex-1 overflow-auto">
                {!submissions?.items?.length ? (
                  <p className="text-center text-gray-300 text-[11px] py-8">No submissions.</p>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {submissions.items.map((s) => (
                      <div key={s.id} className="p-3 hover:bg-gray-50/50">
                        <div className="flex items-start justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                'text-[9px] px-1.5 py-0.5 rounded font-medium',
                                s.status === 'CONVERTED'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : s.status === 'SPAM'
                                    ? 'bg-red-50 text-red-600'
                                    : 'bg-blue-50 text-blue-600',
                              )}
                            >
                              {s.status}
                            </span>
                            <span className="text-[10px] text-gray-400">
                              {formatRelativeTime(s.createdAt)}
                            </span>
                            {s.leadId && (
                              <Link
                                href={`/leads/${s.leadId}`}
                                className="text-[10px] text-violet-600 hover:text-violet-700"
                              >
                                → lead
                              </Link>
                            )}
                          </div>
                          <div className="flex items-center gap-1 opacity-60 hover:opacity-100">
                            {s.status === 'RECEIVED' && (
                              <button
                                onClick={() => convertSubmissionM.mutate(s.id)}
                                title="Convert to lead"
                                className="text-emerald-600 hover:text-emerald-700 p-0.5"
                              >
                                <Check size={11} />
                              </button>
                            )}
                            {s.status !== 'SPAM' && (
                              <button
                                onClick={() => markSpamM.mutate(s.id)}
                                title="Mark as spam"
                                className="text-amber-600 hover:text-amber-700 p-0.5"
                              >
                                <AlertTriangle size={11} />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="bg-gray-50 rounded p-2 text-[10px] font-mono text-gray-700 whitespace-pre-wrap max-h-32 overflow-auto">
                          {Object.entries(s.data).map(([k, v]) => (
                            <div key={k}>
                              <span className="text-gray-400">{k}:</span> {String(v)}
                            </div>
                          ))}
                        </div>
                        {s.errorReason && (
                          <p className="text-[10px] text-red-500 mt-1">{s.errorReason}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'activity' && (
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {!form.activities?.length ? (
                <p className="text-center text-gray-300 text-[11px] py-8">No activity yet.</p>
              ) : (
                form.activities.map((a) => (
                  <div key={a.id} className="flex items-start gap-2 py-1.5">
                    <div className="w-4 pt-0.5 shrink-0 flex justify-center">
                      <Edit3 size={11} className="text-gray-400" />
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

          {tab === 'notes' && (
            <div className="flex-1 overflow-auto p-3">
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Add a note to the form timeline..."
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
                {form.activities
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

        {/* Right panel */}
        <aside className="w-56 border-l border-gray-200 bg-white overflow-auto shrink-0 p-3 space-y-3">
          <p className="text-[9px] uppercase tracking-widest text-gray-400 font-medium">Actions</p>

          {(form.status === 'DRAFT' || form.status === 'PAUSED') && (
            <button
              onClick={() => publishM.mutate()}
              disabled={publishM.isPending || form.fields.length === 0}
              className="w-full flex items-center gap-2 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-30 text-emerald-700 px-2.5 py-1.5 rounded text-[11px] font-medium"
            >
              <Rocket size={11} /> Publish
            </button>
          )}
          {form.status === 'ACTIVE' && (
            <button
              onClick={() => unpublishM.mutate()}
              className="w-full flex items-center gap-2 bg-amber-50 hover:bg-amber-100 text-amber-700 px-2.5 py-1.5 rounded text-[11px] font-medium"
            >
              <Pause size={11} /> Unpublish
            </button>
          )}
          {form.status !== 'ARCHIVED' && (
            <button
              onClick={() => {
                if (confirm('Archive this form?')) archiveM.mutate();
              }}
              className="w-full flex items-center gap-2 bg-gray-50 hover:bg-gray-100 text-gray-700 px-2.5 py-1.5 rounded text-[11px] font-medium"
            >
              <Archive size={11} /> Archive
            </button>
          )}
          {form.status === 'ARCHIVED' && (
            <button
              onClick={() => restoreM.mutate()}
              className="w-full flex items-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-700 px-2.5 py-1.5 rounded text-[11px] font-medium"
            >
              <RotateCcw size={11} /> Restore
            </button>
          )}
          <button
            onClick={() => duplicateM.mutate()}
            className="w-full flex items-center gap-2 bg-gray-50 hover:bg-gray-100 text-gray-700 px-2.5 py-1.5 rounded text-[11px] font-medium"
          >
            <Copy size={11} /> Duplicate
          </button>
          {(form.status === 'DRAFT' || form.status === 'ARCHIVED') && (
            <button
              onClick={() => {
                if (confirm('Delete this form? This cannot be undone.')) deleteM.mutate();
              }}
              className="w-full flex items-center gap-2 bg-gray-50 hover:bg-red-50 text-gray-700 hover:text-red-700 px-2.5 py-1.5 rounded text-[11px] font-medium"
            >
              <Trash2 size={11} /> Delete
            </button>
          )}

          {/* Hosted URL */}
          <div className="pt-3 mt-2 border-t border-gray-100">
            <p className="text-[9px] uppercase tracking-widest text-gray-400 font-medium mb-1.5">
              Hosted URL
            </p>
            {form.status === 'ACTIVE' && form.isPublic ? (
              <CopyChip icon={<Globe size={10} />} text={publicUrl ?? ''} />
            ) : (
              <div className="text-[10px] text-gray-400 bg-gray-50 rounded p-2">
                {form.status !== 'ACTIVE' && 'Publish the form'}
                {form.status === 'ACTIVE' && !form.isPublic && 'Flip isPublic via ••• → toggle'}
              </div>
            )}
          </div>

          {/* Webhook URL */}
          <div>
            <p className="text-[9px] uppercase tracking-widest text-gray-400 font-medium mb-1.5">
              API webhook
            </p>
            <CopyChip icon={<Webhook size={10} />} text={webhookUrl ?? ''} />
            <p className="text-[9px] text-gray-400 mt-1 leading-relaxed">
              Requires an API key with scope <code>forms:write</code>. Manage keys at{' '}
              <Link href="/leads/api-keys" className="text-violet-600 hover:text-violet-700">
                /leads/api-keys
              </Link>
              .
            </p>
          </div>

          <div className="pt-2 border-t border-gray-100">
            <Link
              href={`/chat?q=${encodeURIComponent(`Tell me about form ${form.id}`)}`}
              className="w-full flex items-center gap-2 bg-violet-50 hover:bg-violet-100 text-violet-700 px-2.5 py-1.5 rounded text-[11px] font-medium"
            >
              <MessageSquare size={11} /> Ask AI
            </Link>
          </div>
        </aside>
      </div>

      {showAddField && (
        <AddFieldModal
          formId={id}
          onClose={() => setShowAddField(false)}
          onAdded={() => {
            invalidate();
            setShowAddField(false);
          }}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-widest text-gray-400 font-medium mb-1.5">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-gray-400 shrink-0">{label}</span>
      <span className="text-gray-700 text-right truncate">{value}</span>
    </div>
  );
}

function CopyChip({ icon, text }: { icon: React.ReactNode; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        if (!text) return;
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
        toast.success('Copied');
      }}
      className="w-full flex items-center gap-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 px-2 py-1.5 rounded text-[10px] group"
    >
      <span className="text-gray-400 shrink-0">{icon}</span>
      <code className="flex-1 truncate text-left">{text || '—'}</code>
      {copied ? (
        <Check size={10} className="text-emerald-500 shrink-0" />
      ) : (
        <Copy size={10} className="text-gray-400 shrink-0" />
      )}
    </button>
  );
}

function AddFieldModal({
  formId,
  onClose,
  onAdded,
}: {
  formId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [key, setKey] = useState('');
  const [type, setType] = useState<FormFieldType>('text');
  const [label, setLabel] = useState('');
  const [placeholder, setPlaceholder] = useState('');
  const [required, setRequired] = useState(false);
  const [optionsText, setOptionsText] = useState('');

  const needsOptions = type === 'select' || type === 'radio';

  const addM = useMutation({
    mutationFn: () =>
      api.post(`/forms/${formId}/fields`, {
        key,
        type,
        label,
        placeholder: placeholder || undefined,
        required: required || undefined,
        options: needsOptions
          ? optionsText
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
              .map((l) => {
                const [value, lab] = l.split('|').map((s) => s.trim());
                return { value, label: lab ?? value };
              })
          : undefined,
      }),
    onSuccess: () => {
      toast.success('Field added');
      onAdded();
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      toast.error(msg ?? 'Failed to add field');
    },
  });

  const canSubmit = key.trim() && label.trim() && (!needsOptions || optionsText.trim());

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[460px] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold">Add Field</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] text-gray-500">
            <span className="block uppercase tracking-widest mb-0.5">Key</span>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="e.g. email"
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs font-mono"
            />
          </label>
          <label className="text-[10px] text-gray-500">
            <span className="block uppercase tracking-widest mb-0.5">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as FormFieldType)}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs"
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="text-[10px] text-gray-500 block">
          <span className="block uppercase tracking-widest mb-0.5">Label</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Your email address"
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs"
          />
        </label>

        <label className="text-[10px] text-gray-500 block">
          <span className="block uppercase tracking-widest mb-0.5">Placeholder (optional)</span>
          <input
            value={placeholder}
            onChange={(e) => setPlaceholder(e.target.value)}
            placeholder="e.g. you@example.com"
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs"
          />
        </label>

        {needsOptions && (
          <label className="text-[10px] text-gray-500 block">
            <span className="block uppercase tracking-widest mb-0.5">
              Options (one per line, format: <code>value|label</code>)
            </span>
            <textarea
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              placeholder={'red|Red\nblue|Blue\ngreen|Green'}
              rows={4}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs font-mono"
            />
          </label>
        )}

        <label className="flex items-center gap-2 text-[11px] text-gray-700">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="accent-violet-500"
          />
          Required
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-gray-500 text-[11px] px-2 py-1">
            Cancel
          </button>
          <button
            onClick={() => addM.mutate()}
            disabled={!canSubmit || addM.isPending}
            className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30"
          >
            {addM.isPending ? 'Adding…' : 'Add field'}
          </button>
        </div>
      </div>
    </div>
  );
}
