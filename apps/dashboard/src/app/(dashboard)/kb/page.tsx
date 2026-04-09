'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { Plus, BookOpen, Eye } from 'lucide-react';
import { toast } from 'sonner';

interface Article {
  id: string;
  title: string;
  category: string;
  views: number;
  status: string;
  updatedAt: string;
}

export default function KnowledgeBasePage() {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [content, setContent] = useState('');
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () => api.post('/kb/articles', { title, category, content }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kb-articles'] });
      toast.success('Article created');
      setShowForm(false); setTitle(''); setCategory(''); setContent('');
    },
    onError: () => toast.error('Failed to create article'),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['kb-articles'],
    queryFn: async () => {
      const res = await api.get<{ data: { items: Article[]; total: number } }>('/kb/articles');
      return res.data.data;
    },
  });

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <span className="text-xs font-semibold text-gray-900">Knowledge Base</span>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium">
          <Plus size={11} /> Add Article
        </button>
      </div>

      {showForm && (
        <div className="border-b border-gray-200 bg-white p-3 space-y-2 shrink-0">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Article title (required)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder="Content" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none" />
          <div className="flex gap-2">
            <button onClick={() => createMutation.mutate()} disabled={!title} className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30">Create</button>
            <button onClick={() => setShowForm(false)} className="text-gray-400 text-[11px] px-2 py-1">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-8 text-center text-gray-300 text-xs">Loading...</div>
        ) : !data?.items?.length ? (
          <div className="p-8 text-center text-gray-300">
            <BookOpen size={24} className="mx-auto mb-2 text-gray-200" />
            <p className="text-xs">No articles yet</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200 sticky top-0">
              <tr>
                {['Title', 'Category', 'Views', 'Status', 'Updated'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {data.items.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50/50 transition-colors cursor-pointer">
                  <td className="px-3 py-2 text-xs font-medium text-gray-900">{a.title}</td>
                  <td className="px-3 py-2"><span className="text-[10px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded">{a.category}</span></td>
                  <td className="px-3 py-2 text-xs text-gray-400 flex items-center gap-1"><Eye size={10} className="text-gray-300" />{a.views}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${a.status === 'published' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{a.status}</span>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-gray-300">{new Date(a.updatedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data && <div className="h-9 border-t border-gray-200 px-3 flex items-center shrink-0 bg-white">
        <span className="text-[10px] text-gray-400">{data.total} articles</span>
      </div>}
    </div>
  );
}
