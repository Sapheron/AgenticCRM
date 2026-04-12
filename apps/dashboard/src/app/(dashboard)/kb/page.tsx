'use client';

/**
 * Knowledge Base list — filter rail + stats strip + bulk toolbar + table.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { formatRelativeTime, cn } from '@/lib/utils';
import {
  BookOpen, Plus, Search, X, Trash2, Rocket, Archive, Eye,
} from 'lucide-react';
import { toast } from 'sonner';

type KBStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

interface ArticleRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: KBStatus;
  category: string | null;
  isPublic: boolean;
  viewCount: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  rangeDays: number;
  totalArticles: number;
  publishedArticles: number;
  totalViews: number;
  topCategories: Array<{ category: string; count: number }>;
}

const STATUS_COLORS: Record<KBStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-500',
  PUBLISHED: 'bg-emerald-50 text-emerald-700',
  ARCHIVED: 'bg-gray-50 text-gray-400',
};

const ALL_STATUSES: KBStatus[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

export default function KBPage() {
  const qc = useQueryClient();
  const [selectedStatuses, setSelectedStatuses] = useState<Set<KBStatus>>(new Set());
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);

  const { data: stats } = useQuery({
    queryKey: ['kb-stats'],
    queryFn: async () => { const r = await api.get<{ data: Stats }>('/kb/stats'); return r.data.data; },
  });

  const queryKey = useMemo(() => ['kb', [...selectedStatuses].join(','), search], [selectedStatuses, search]);
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedStatuses.size > 0) params.set('status', [...selectedStatuses].join(','));
      if (search) params.set('search', search);
      params.set('limit', '100');
      const r = await api.get<{ data: { items: ArticleRow[]; total: number } }>(`/kb?${params.toString()}`);
      return r.data.data;
    },
  });

  const invalidateAfterBulk = () => {
    void qc.invalidateQueries({ queryKey: ['kb'] });
    void qc.invalidateQueries({ queryKey: ['kb-stats'] });
    setSelectedIds(new Set());
  };
  const bulkPublish = useMutation({ mutationFn: () => api.post('/kb/bulk/publish', { ids: [...selectedIds] }), onSuccess: () => { invalidateAfterBulk(); toast.success('Published'); }, onError: () => toast.error('Failed') });
  const bulkArchive = useMutation({ mutationFn: () => api.post('/kb/bulk/archive', { ids: [...selectedIds] }), onSuccess: () => { invalidateAfterBulk(); toast.success('Archived'); }, onError: () => toast.error('Failed') });
  const bulkDelete = useMutation({ mutationFn: () => api.post('/kb/bulk/delete', { ids: [...selectedIds] }), onSuccess: () => { invalidateAfterBulk(); toast.success('Deleted'); }, onError: () => toast.error('Failed') });

  const publishM = useMutation({
    mutationFn: (id: string) => api.post(`/kb/${id}/publish`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['kb'] }); toast.success('Published'); },
    onError: (err: unknown) => { const msg = err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { message?: string } } }).response?.data?.message : null; toast.error(msg ?? 'Failed'); },
  });

  const toggleStatus = (s: KBStatus) => { setSelectedStatuses((prev) => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; }); };
  const toggleSelect = (id: string) => { setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const allSelected = items.length > 0 && items.every((a) => selectedIds.has(a.id));

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2"><BookOpen size={14} className="text-violet-500" /><span className="text-xs font-semibold text-gray-900">Knowledge Base</span></div>
        <div className="flex items-center gap-2">
          <div className="relative"><Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search articles..." className="w-52 pl-6 pr-2 py-1 text-[11px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-violet-400" /></div>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium"><Plus size={11} /> New Article</button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-4 gap-2 border-b border-gray-200 bg-white px-4 py-2.5 shrink-0">
          <StatTile label="Total" value={stats.totalArticles} />
          <StatTile label="Published" value={stats.publishedArticles} tint="emerald" />
          <StatTile label="Total views" value={stats.totalViews} tint="blue" />
          <StatTile label="Top category" value={stats.topCategories[0]?.category ?? '—'} tint="violet" />
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <aside className="w-48 border-r border-gray-200 bg-white overflow-auto shrink-0 p-3 space-y-4">
          <div>
            <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-1.5 font-medium">Status</p>
            <div className="space-y-1">{ALL_STATUSES.map((s) => (
              <label key={s} className="flex items-center gap-2 cursor-pointer text-[11px]">
                <input type="checkbox" checked={selectedStatuses.has(s)} onChange={() => toggleStatus(s)} className="accent-violet-500 w-3 h-3" />
                <span className={cn('px-1.5 py-0.5 rounded text-[10px]', STATUS_COLORS[s])}>{s}</span>
              </label>
            ))}</div>
          </div>
          {(selectedStatuses.size > 0 || search) && (
            <button onClick={() => { setSelectedStatuses(new Set()); setSearch(''); }} className="flex items-center gap-1 text-[10px] text-violet-600 hover:text-violet-700"><X size={10} /> Clear</button>
          )}
        </aside>

        <main className="flex-1 flex flex-col min-w-0 bg-white">
          {selectedIds.size > 0 && (
            <div className="h-9 border-b border-gray-200 px-3 flex items-center gap-3 shrink-0 bg-violet-50">
              <span className="text-[11px] text-violet-700 font-medium">{selectedIds.size} selected</span>
              <div className="flex-1" />
              <button onClick={() => bulkPublish.mutate()} className="flex items-center gap-1 text-[11px] text-gray-700 hover:text-gray-900 px-2 py-1 rounded hover:bg-white"><Rocket size={11} /> Publish</button>
              <button onClick={() => bulkArchive.mutate()} className="flex items-center gap-1 text-[11px] text-amber-700 px-2 py-1 rounded hover:bg-white"><Archive size={11} /> Archive</button>
              <button onClick={() => { if (confirm(`Delete ${selectedIds.size}?`)) bulkDelete.mutate(); }} className="flex items-center gap-1 text-[11px] text-red-700 px-2 py-1 rounded hover:bg-white"><Trash2 size={11} /> Delete</button>
              <button onClick={() => setSelectedIds(new Set())} className="text-[11px] text-gray-400 px-2"><X size={11} /></button>
            </div>
          )}

          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="p-8 text-center text-gray-300 text-xs">Loading...</div>
            ) : items.length === 0 ? (
              <div className="p-12 text-center text-gray-300">
                <BookOpen size={28} className="mx-auto mb-2 text-gray-200" />
                <p className="text-xs">No articles match.</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50/80 border-b border-gray-200 sticky top-0 z-10">
                  <tr>
                    <th className="w-8 px-2 py-2"><input type="checkbox" checked={allSelected} onChange={(e) => { if (e.target.checked) setSelectedIds(new Set(items.map((a) => a.id))); else setSelectedIds(new Set()); }} className="accent-violet-500 w-3 h-3" /></th>
                    {['Title', 'Status', 'Public', 'Category', 'Views', 'Updated', ''].map((h) => (
                      <th key={h} className="text-left px-2 py-2 text-[9px] font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((a) => (
                    <tr key={a.id} className="hover:bg-gray-50/50">
                      <td className="px-2 py-2 w-8"><input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => toggleSelect(a.id)} className="accent-violet-500 w-3 h-3" /></td>
                      <td className="px-2 py-2">
                        <Link href={`/kb/${a.id}`} className="text-xs font-medium text-gray-900 hover:text-violet-600">{a.title}</Link>
                        <div className="text-[10px] text-gray-400">/{a.slug}</div>
                      </td>
                      <td className="px-2 py-2"><span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium', STATUS_COLORS[a.status])}>{a.status}</span></td>
                      <td className="px-2 py-2 text-[10px] text-gray-500">{a.isPublic ? <span className="text-emerald-600">●</span> : <span className="text-gray-300">○</span>}</td>
                      <td className="px-2 py-2 text-[10px] text-gray-500">{a.category ?? '—'}</td>
                      <td className="px-2 py-2 text-[10px] text-gray-500 tabular-nums flex items-center gap-1"><Eye size={9} /> {a.viewCount}</td>
                      <td className="px-2 py-2 text-[10px] text-gray-400">{formatRelativeTime(a.updatedAt)}</td>
                      <td className="px-2 py-2">
                        {a.status === 'DRAFT' && <button onClick={() => publishM.mutate(a.id)} title="Publish" className="text-emerald-600 hover:text-emerald-700 p-0.5"><Rocket size={11} /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="h-8 border-t border-gray-200 px-3 flex items-center shrink-0 bg-white"><span className="text-[10px] text-gray-400">{items.length} of {total} article{total === 1 ? '' : 's'}</span></div>
        </main>
      </div>

      {showCreate && <CreateArticleModal onClose={() => setShowCreate(false)} onCreated={() => { void qc.invalidateQueries({ queryKey: ['kb'] }); void qc.invalidateQueries({ queryKey: ['kb-stats'] }); setShowCreate(false); }} />}
    </div>
  );
}

function StatTile({ label, value, tint }: { label: string; value: string | number; tint?: 'emerald' | 'blue' | 'violet' }) {
  const tints: Record<string, string> = { emerald: 'text-emerald-600', blue: 'text-blue-600', violet: 'text-violet-600' };
  return (
    <div className="bg-gray-50/80 border border-gray-100 rounded px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-widest text-gray-400 font-medium">{label}</div>
      <div className={cn('text-sm font-semibold tabular-nums', tint ? tints[tint] : 'text-gray-900')}>{value}</div>
    </div>
  );
}

function CreateArticleModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('');

  const createM = useMutation({
    mutationFn: () => api.post('/kb', { title, content, category: category || undefined }),
    onSuccess: () => { toast.success('Article created in DRAFT'); onCreated(); },
    onError: (err: unknown) => { const msg = err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { message?: string } } }).response?.data?.message : null; toast.error(msg ?? 'Failed'); },
  });

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[540px] p-4 space-y-3">
        <div className="flex items-center justify-between"><h3 className="text-xs font-semibold">New Article</h3><button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={14} /></button></div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (required)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" autoFocus />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category (optional)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Article content (markdown supported)" rows={8} className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-400" />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-gray-500 text-[11px] px-2 py-1">Cancel</button>
          <button onClick={() => createM.mutate()} disabled={!title.trim() || !content.trim() || createM.isPending} className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30">{createM.isPending ? 'Creating…' : 'Create as Draft'}</button>
        </div>
      </div>
    </div>
  );
}
