'use client';

/**
 * KB Article detail — 3-column Linear layout.
 *
 * Left:   metadata (slug, status, category, public, views, tags)
 * Center: tabs — Content / Activity / Notes
 * Right:  actions (publish / unpublish / archive / restore / duplicate / delete)
 *         + public URL copy + Ask AI
 */

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { cn, formatRelativeTime } from '@/lib/utils';
import {
  ArrowLeft, Rocket, Pause, Archive, RotateCcw, Copy, Check, Trash2,
  Globe, MessageSquare, Eye, Clock,
} from 'lucide-react';
import { toast } from 'sonner';

type KBStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

interface Article {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  content: string;
  status: KBStatus;
  category: string | null;
  isPublic: boolean;
  viewCount: number;
  tags: string[];
  notes: string | null;
  publishedAt: string | null;
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

const STATUS_COLORS: Record<KBStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-500',
  PUBLISHED: 'bg-emerald-50 text-emerald-700',
  ARCHIVED: 'bg-gray-50 text-gray-400',
};

export default function KBArticleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const id = params.id as string;

  const [tab, setTab] = useState<'content' | 'activity' | 'notes'>('content');
  const [noteDraft, setNoteDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [contentDraft, setContentDraft] = useState('');

  const { data: article, isLoading } = useQuery({
    queryKey: ['kb-article', id],
    queryFn: async () => { const r = await api.get<{ data: Article }>(`/kb/${id}`); return r.data.data; },
  });

  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['kb-article', id] }); };
  const onErr = (err: unknown) => {
    const msg = err && typeof err === 'object' && 'response' in err
      ? (err as { response?: { data?: { message?: string } } }).response?.data?.message : null;
    toast.error(msg ?? 'Failed');
  };

  const publishM = useMutation({ mutationFn: () => api.post(`/kb/${id}/publish`), onSuccess: () => { invalidate(); toast.success('Published'); }, onError: onErr });
  const unpublishM = useMutation({ mutationFn: () => api.post(`/kb/${id}/unpublish`), onSuccess: () => { invalidate(); toast.success('Unpublished'); }, onError: onErr });
  const archiveM = useMutation({ mutationFn: () => api.post(`/kb/${id}/archive`), onSuccess: () => { invalidate(); toast.success('Archived'); }, onError: onErr });
  const restoreM = useMutation({ mutationFn: () => api.post(`/kb/${id}/restore`), onSuccess: () => { invalidate(); toast.success('Restored'); }, onError: onErr });
  const duplicateM = useMutation({ mutationFn: () => api.post<{ data: Article }>(`/kb/${id}/duplicate`), onSuccess: (r) => { toast.success('Duplicated'); router.push(`/kb/${r.data.data.id}`); }, onError: onErr });
  const deleteM = useMutation({ mutationFn: () => api.delete(`/kb/${id}`), onSuccess: () => { toast.success('Deleted'); router.push('/kb'); }, onError: onErr });
  const addNoteM = useMutation({ mutationFn: () => api.post(`/kb/${id}/notes`, { body: noteDraft }), onSuccess: () => { invalidate(); setNoteDraft(''); toast.success('Note added'); } });
  const saveContentM = useMutation({
    mutationFn: () => api.patch(`/kb/${id}`, { content: contentDraft }),
    onSuccess: () => { invalidate(); setEditing(false); toast.success('Content saved'); },
    onError: onErr,
  });
  const togglePublicM = useMutation({
    mutationFn: (isPublic: boolean) => api.patch(`/kb/${id}`, { isPublic }),
    onSuccess: () => { invalidate(); toast.success('Updated'); },
    onError: onErr,
  });

  const publicUrl = article && typeof window !== 'undefined'
    ? `${window.location.origin}/public/kb/${article.slug}`
    : null;

  if (isLoading) return <div className="h-full flex items-center justify-center"><p className="text-gray-300 text-xs">Loading…</p></div>;
  if (!article) return <div className="h-full flex items-center justify-center"><p className="text-gray-300 text-xs">Article not found</p></div>;

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 border-b border-gray-200 px-4 flex items-center gap-3 shrink-0 bg-white">
        <Link href="/kb" className="text-gray-400 hover:text-gray-600"><ArrowLeft size={14} /></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xs font-semibold text-gray-900 truncate">{article.title}</h1>
          <p className="text-[10px] text-gray-400 truncate">/{article.slug} {article.description ? `· ${article.description}` : ''}</p>
        </div>
        <span className={cn('text-[10px] px-2 py-0.5 rounded font-medium', STATUS_COLORS[article.status])}>{article.status}</span>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Left */}
        <aside className="w-64 border-r border-gray-200 bg-white overflow-auto shrink-0">
          <div className="p-3 space-y-4">
            <Section title="Article">
              <Row label="Category" value={article.category ?? '—'} />
              <Row label="Public" value={
                <button onClick={() => togglePublicM.mutate(!article.isPublic)} className={cn('text-[10px] px-1.5 py-0.5 rounded', article.isPublic ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500')}>
                  {article.isPublic ? 'Yes' : 'No'}
                </button>
              } />
              <Row label="Views" value={<span className="flex items-center gap-1"><Eye size={9} /> {article.viewCount}</span>} />
              {article.publishedAt && <Row label="Published" value={formatRelativeTime(article.publishedAt)} />}
              <Row label="Created" value={formatRelativeTime(article.createdAt)} />
              <Row label="Updated" value={formatRelativeTime(article.updatedAt)} />
            </Section>
            {article.tags.length > 0 && (
              <Section title="Tags">
                <div className="flex flex-wrap gap-1">{article.tags.map((t) => (
                  <span key={t} className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{t}</span>
                ))}</div>
              </Section>
            )}
          </div>
        </aside>

        {/* Center */}
        <main className="flex-1 flex flex-col min-w-0 bg-white">
          <div className="h-9 border-b border-gray-200 px-3 flex items-center gap-4 shrink-0">
            {(['content', 'activity', 'notes'] as const).map((t) => (
              <button key={t} onClick={() => { setTab(t); if (t === 'content' && !editing) setContentDraft(article.content); }} className={cn('text-[11px] py-1 border-b-2 transition-colors', tab === t ? 'border-violet-500 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600')}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {tab === 'content' && (
            <div className="flex-1 overflow-auto p-4">
              {editing ? (
                <div className="space-y-2">
                  <textarea value={contentDraft} onChange={(e) => setContentDraft(e.target.value)} rows={20} className="w-full border border-gray-200 rounded px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-violet-400" />
                  <div className="flex gap-2">
                    <button onClick={() => saveContentM.mutate()} disabled={saveContentM.isPending} className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30">{saveContentM.isPending ? 'Saving…' : 'Save'}</button>
                    <button onClick={() => setEditing(false)} className="text-gray-500 text-[11px] px-2 py-1">Cancel</button>
                  </div>
                </div>
              ) : (
                <div>
                  {article.status !== 'ARCHIVED' && (
                    <button onClick={() => { setContentDraft(article.content); setEditing(true); }} className="mb-3 text-[11px] text-violet-600 hover:text-violet-700">Edit content</button>
                  )}
                  <pre className="whitespace-pre-wrap text-xs text-gray-800 leading-relaxed font-mono">{article.content}</pre>
                </div>
              )}
            </div>
          )}

          {tab === 'activity' && (
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {!article.activities?.length ? (
                <p className="text-center text-gray-300 text-[11px] py-8">No activity.</p>
              ) : (
                article.activities.map((a) => (
                  <div key={a.id} className="flex items-start gap-2 py-1.5">
                    <div className="w-4 pt-0.5 shrink-0 flex justify-center"><Clock size={11} className="text-gray-400" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[11px] font-medium text-gray-900">{a.title}</span>
                        <span className="text-[9px] text-gray-400 capitalize">{a.actorType}</span>
                        <span className="text-[9px] text-gray-400 ml-auto">{formatRelativeTime(a.createdAt)}</span>
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
              <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Add a note…" rows={4} className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400 mb-2" />
              <button onClick={() => addNoteM.mutate()} disabled={!noteDraft.trim() || addNoteM.isPending} className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30">{addNoteM.isPending ? 'Saving…' : 'Add Note'}</button>
              <div className="mt-4 space-y-2">
                {article.activities?.filter((a) => a.type === 'NOTE_ADDED').map((a) => (
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

        {/* Right */}
        <aside className="w-56 border-l border-gray-200 bg-white overflow-auto shrink-0 p-3 space-y-2">
          <p className="text-[9px] uppercase tracking-widest text-gray-400 font-medium mb-1">Actions</p>

          {article.status === 'DRAFT' && (
            <button onClick={() => publishM.mutate()} className="w-full flex items-center gap-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2.5 py-1.5 rounded text-[11px] font-medium"><Rocket size={11} /> Publish</button>
          )}
          {article.status === 'PUBLISHED' && (
            <button onClick={() => unpublishM.mutate()} className="w-full flex items-center gap-2 bg-amber-50 hover:bg-amber-100 text-amber-700 px-2.5 py-1.5 rounded text-[11px] font-medium"><Pause size={11} /> Unpublish</button>
          )}
          {article.status !== 'ARCHIVED' && (
            <button onClick={() => archiveM.mutate()} className="w-full flex items-center gap-2 bg-gray-50 hover:bg-gray-100 text-gray-700 px-2.5 py-1.5 rounded text-[11px] font-medium"><Archive size={11} /> Archive</button>
          )}
          {article.status === 'ARCHIVED' && (
            <button onClick={() => restoreM.mutate()} className="w-full flex items-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-700 px-2.5 py-1.5 rounded text-[11px] font-medium"><RotateCcw size={11} /> Restore</button>
          )}
          <button onClick={() => duplicateM.mutate()} className="w-full flex items-center gap-2 bg-gray-50 hover:bg-gray-100 text-gray-700 px-2.5 py-1.5 rounded text-[11px] font-medium"><Copy size={11} /> Duplicate</button>
          {article.status !== 'PUBLISHED' && (
            <button onClick={() => { if (confirm('Delete?')) deleteM.mutate(); }} className="w-full flex items-center gap-2 bg-gray-50 hover:bg-red-50 text-gray-700 hover:text-red-700 px-2.5 py-1.5 rounded text-[11px] font-medium"><Trash2 size={11} /> Delete</button>
          )}

          {article.status === 'PUBLISHED' && article.isPublic && (
            <div className="pt-3 mt-2 border-t border-gray-100">
              <p className="text-[9px] uppercase tracking-widest text-gray-400 font-medium mb-1.5">Public URL</p>
              <CopyChip icon={<Globe size={10} />} text={publicUrl ?? ''} />
            </div>
          )}

          <div className="pt-2 mt-2 border-t border-gray-100">
            <Link href={`/chat?q=${encodeURIComponent(`Tell me about KB article "${article.title}"`)}`} className="w-full flex items-center gap-2 bg-violet-50 hover:bg-violet-100 text-violet-700 px-2.5 py-1.5 rounded text-[11px] font-medium">
              <MessageSquare size={11} /> Ask AI
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (<div><p className="text-[9px] uppercase tracking-widest text-gray-400 font-medium mb-1.5">{title}</p><div className="space-y-1">{children}</div></div>);
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (<div className="flex items-center justify-between gap-2 text-[11px]"><span className="text-gray-400 shrink-0">{label}</span><span className="text-gray-700 text-right truncate">{value}</span></div>);
}

function CopyChip({ icon, text }: { icon: React.ReactNode; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { if (!text) return; void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); toast.success('Copied'); }} className="w-full flex items-center gap-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 px-2 py-1.5 rounded text-[10px] group">
      <span className="text-gray-400 shrink-0">{icon}</span>
      <code className="flex-1 truncate text-left">{text || '—'}</code>
      {copied ? <Check size={10} className="text-emerald-500 shrink-0" /> : <Copy size={10} className="text-gray-400 shrink-0" />}
    </button>
  );
}
