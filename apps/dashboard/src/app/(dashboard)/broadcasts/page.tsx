'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { formatRelativeTime, cn } from '@/lib/utils';
import { Megaphone, Plus, Trash2, CheckCircle, Loader2, Clock } from 'lucide-react';
import { toast } from 'sonner';

interface Broadcast {
  id: string;
  name: string;
  message: string;
  targetTags: string[];
  totalCount: number;
  sentCount: number;
  failedCount: number;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export default function BroadcastsPage() {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [targetTags, setTargetTags] = useState('');
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['broadcasts'],
    queryFn: async () => {
      const res = await api.get<{ data: { items: Broadcast[] } }>('/broadcasts');
      return res.data.data.items;
    },
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/broadcasts', {
      name,
      message,
      targetTags: targetTags.split(',').map((t) => t.trim()).filter(Boolean),
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['broadcasts'] });
      toast.success('Broadcast created and queued');
      setShowForm(false);
      setName(''); setMessage(''); setTargetTags('');
    },
    onError: () => toast.error('Failed to create broadcast'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/broadcasts/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['broadcasts'] }); toast.success('Broadcast cancelled'); },
    onError: () => toast.error('Cannot cancel a broadcast already in progress'),
  });

  const getStatusBadge = (b: Broadcast) => {
    if (b.completedAt) return <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full"><CheckCircle size={10} />Completed</span>;
    if (b.startedAt) return <span className="flex items-center gap-1 text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full"><Loader2 size={10} className="animate-spin" />Running</span>;
    if (b.scheduledAt) return <span className="flex items-center gap-1 text-xs text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full"><Clock size={10} />Scheduled</span>;
    return <span className="text-xs text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded-full">Queued</span>;
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Broadcasts</h1>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <Plus size={14} />
          New Broadcast
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
          <h3 className="font-semibold text-gray-900 mb-4">New Broadcast</h3>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-700">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly Newsletter" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Message</label>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Type your message…" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Target Tags (comma-separated)</label>
              <input value={targetTags} onChange={(e) => setTargetTags(e.target.value)} placeholder="e.g. premium, trial" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              <p className="text-xs text-gray-400 mt-1">Leave empty to target all opted-in contacts</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => createMutation.mutate()} disabled={!name || !message || createMutation.isPending} className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                {createMutation.isPending ? 'Creating…' : 'Send Now'}
              </button>
              <button onClick={() => setShowForm(false)} className="border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Loading…</div>
        ) : !data?.length ? (
          <div className="p-12 text-center">
            <Megaphone size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-400">No broadcasts yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.map((b) => (
              <div key={b.id} className="p-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-medium text-sm text-gray-900">{b.name}</span>
                    {getStatusBadge(b)}
                  </div>
                  <p className="text-sm text-gray-500 truncate">{b.message}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                    <span>{b.totalCount} recipients</span>
                    {b.sentCount > 0 && <span className="text-green-600">{b.sentCount} sent</span>}
                    {b.failedCount > 0 && <span className="text-red-500">{b.failedCount} failed</span>}
                    {b.targetTags.length > 0 && <span>Tags: {b.targetTags.join(', ')}</span>}
                    <span>{formatRelativeTime(b.createdAt)}</span>
                  </div>
                </div>
                {!b.startedAt && (
                  <button onClick={() => deleteMutation.mutate(b.id)} className="text-gray-400 hover:text-red-500 transition p-1">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
