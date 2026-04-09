'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { cn, formatRelativeTime } from '@/lib/utils';
import { CheckSquare, Plus, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  dueAt?: string;
  completedAt?: string;
  contact?: { displayName?: string; phoneNumber: string };
  deal?: { title: string };
  assignedAgent?: { firstName: string; lastName: string };
}

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'bg-gray-50 text-gray-400',
  MEDIUM: 'bg-blue-50 text-blue-500',
  HIGH: 'bg-orange-50 text-orange-500',
  URGENT: 'bg-red-50 text-red-500',
};

export default function TasksPage() {
  const [showOverdue, setShowOverdue] = useState(false);
  const [page] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [priority, setPriority] = useState('');
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', showOverdue, page],
    queryFn: async () => {
      const res = await api.get<{ data: { items: Task[]; total: number } }>('/tasks', {
        params: { status: 'TODO,IN_PROGRESS', overdue: showOverdue ? 'true' : undefined, page },
      });
      return res.data.data;
    },
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/tasks/${id}/complete`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tasks'] }); toast.success('Done'); },
    onError: () => toast.error('Failed'),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/tasks', { title, dueAt, priority }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Task created');
      setShowForm(false); setTitle(''); setDueAt(''); setPriority('');
    },
    onError: () => toast.error('Failed to create task'),
  });

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <span className="text-xs font-semibold text-gray-900">Tasks</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] text-gray-400 cursor-pointer">
            <input type="checkbox" checked={showOverdue} onChange={(e) => setShowOverdue(e.target.checked)} className="rounded text-violet-500 w-3 h-3" />
            Overdue only
          </label>
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium">
            <Plus size={11} />
            Add
          </button>
        </div>
      </div>

      {showForm && (
        <div className="border-b border-gray-200 bg-white p-3 space-y-2 shrink-0">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title (required)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <input value={dueAt} onChange={(e) => setDueAt(e.target.value)} placeholder="Due date" type="datetime-local" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400">
            <option value="">Select priority...</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
          <div className="flex gap-2">
            <button onClick={() => createMutation.mutate()} disabled={!title} className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30">Create</button>
            <button onClick={() => setShowForm(false)} className="text-gray-400 text-[11px] px-2 py-1">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto bg-white">
        {isLoading ? (
          <div className="p-8 text-center text-gray-300 text-xs">Loading...</div>
        ) : data?.items.length === 0 ? (
          <div className="p-12 text-center">
            <CheckSquare size={24} className="mx-auto text-gray-200 mb-2" />
            <p className="text-xs text-gray-300">No tasks</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {data?.items.map((task) => {
              const isOverdue = task.dueAt && new Date(task.dueAt) < new Date() && task.status !== 'DONE';
              return (
                <div key={task.id} className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-gray-50/50 transition-colors">
                  <button
                    onClick={() => completeMutation.mutate(task.id)}
                    className="mt-0.5 w-4 h-4 rounded border border-gray-200 hover:border-violet-400 shrink-0 flex items-center justify-center transition-colors"
                  >
                    {task.status === 'DONE' && <div className="w-2 h-2 bg-violet-500 rounded-sm" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn('text-xs font-medium text-gray-900', task.status === 'DONE' && 'line-through text-gray-300')}>
                        {task.title}
                      </p>
                      <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0', PRIORITY_COLORS[task.priority])}>
                        {task.priority}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400">
                      {task.contact && <span>{task.contact.displayName ?? task.contact.phoneNumber}</span>}
                      {task.deal && <span>· {task.deal.title}</span>}
                      {task.dueAt && (
                        <span className={cn('flex items-center gap-0.5', isOverdue && 'text-red-400 font-medium')}>
                          {isOverdue && <AlertCircle size={8} />}
                          {formatRelativeTime(task.dueAt)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="h-9 border-t border-gray-200 px-3 flex items-center shrink-0 bg-white">
        <span className="text-[10px] text-gray-400">{data?.total ?? 0} tasks</span>
      </div>
    </div>
  );
}
