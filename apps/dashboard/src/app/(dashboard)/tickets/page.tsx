'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { Plus, LifeBuoy } from 'lucide-react';
import { toast } from 'sonner';

interface Ticket {
  id: string;
  title: string;
  status: string;
  priority: string;
  category: string;
  createdAt: string;
}

const statusColor: Record<string, string> = {
  open: 'bg-blue-50 text-blue-600',
  in_progress: 'bg-amber-50 text-amber-600',
  resolved: 'bg-emerald-50 text-emerald-600',
  closed: 'bg-gray-100 text-gray-400',
};

const priorityColor: Record<string, string> = {
  urgent: 'bg-red-50 text-red-600',
  high: 'bg-orange-50 text-orange-600',
  medium: 'bg-amber-50 text-amber-600',
  low: 'bg-gray-100 text-gray-400',
};

export default function TicketsPage() {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () => api.post('/tickets', { title, priority, category, description }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tickets'] });
      toast.success('Ticket created');
      setShowForm(false); setTitle(''); setPriority(''); setCategory(''); setDescription('');
    },
    onError: () => toast.error('Failed to create ticket'),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['tickets'],
    queryFn: async () => {
      const res = await api.get<{ data: { items: Ticket[]; total: number } }>('/tickets');
      return res.data.data;
    },
  });

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <span className="text-xs font-semibold text-gray-900">Tickets</span>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium">
          <Plus size={11} /> Add
        </button>
      </div>

      {showForm && (
        <div className="border-b border-gray-200 bg-white p-3 space-y-2 shrink-0">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ticket title (required)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400">
            <option value="">Select priority...</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Description" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none" />
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
            <LifeBuoy size={24} className="mx-auto mb-2 text-gray-200" />
            <p className="text-xs">No tickets yet</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200 sticky top-0">
              <tr>
                {['Title', 'Status', 'Priority', 'Category', 'Created'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {data.items.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50/50 transition-colors cursor-pointer">
                  <td className="px-3 py-2 text-xs font-medium text-gray-900">{t.title}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor[t.status] ?? 'bg-gray-100 text-gray-400'}`}>{t.status.replace('_', ' ')}</span></td>
                  <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${priorityColor[t.priority] ?? 'bg-gray-100 text-gray-400'}`}>{t.priority}</span></td>
                  <td className="px-3 py-2"><span className="text-[10px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded">{t.category}</span></td>
                  <td className="px-3 py-2 text-[11px] text-gray-300">{new Date(t.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data && <div className="h-9 border-t border-gray-200 px-3 flex items-center shrink-0 bg-white">
        <span className="text-[10px] text-gray-400">{data.total} tickets</span>
      </div>}
    </div>
  );
}
