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
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-blue-100 text-blue-700',
  HIGH: 'bg-orange-100 text-orange-700',
  URGENT: 'bg-red-100 text-red-700',
};

export default function TasksPage() {
  const [showOverdue, setShowOverdue] = useState(false);
  const [page, setPage] = useState(1);
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
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tasks'] }); toast.success('Task completed'); },
    onError: () => toast.error('Failed to complete task'),
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Tasks</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={showOverdue} onChange={(e) => setShowOverdue(e.target.checked)} className="rounded text-green-600" />
            Show overdue only
          </label>
          <button className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            <Plus size={14} />
            New Task
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Loading…</div>
        ) : data?.items.length === 0 ? (
          <div className="p-12 text-center">
            <CheckSquare size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-400">No tasks found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {data?.items.map((task) => {
              const isOverdue = task.dueAt && new Date(task.dueAt) < new Date() && task.status !== 'DONE';
              return (
                <div key={task.id} className="flex items-start gap-4 p-4 hover:bg-gray-50 transition-colors">
                  <button
                    onClick={() => completeMutation.mutate(task.id)}
                    className="mt-0.5 w-5 h-5 rounded-full border-2 border-gray-300 hover:border-green-500 shrink-0 flex items-center justify-center transition-colors"
                  >
                    {task.status === 'DONE' && <div className="w-2.5 h-2.5 bg-green-500 rounded-full" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <p className={cn('text-sm font-medium text-gray-900', task.status === 'DONE' && 'line-through text-gray-400')}>
                        {task.title}
                      </p>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', PRIORITY_COLORS[task.priority])}>
                          {task.priority}
                        </span>
                      </div>
                    </div>
                    {task.description && <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                      {task.contact && <span>{task.contact.displayName ?? task.contact.phoneNumber}</span>}
                      {task.deal && <span>· {task.deal.title}</span>}
                      {task.dueAt && (
                        <span className={cn('flex items-center gap-1', isOverdue && 'text-red-500 font-medium')}>
                          {isOverdue && <AlertCircle size={10} />}
                          Due {formatRelativeTime(task.dueAt)}
                        </span>
                      )}
                      {task.assignedAgent && (
                        <span>· {task.assignedAgent.firstName} {task.assignedAgent.lastName}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="px-4 py-3 border-t text-sm text-gray-500">
          Total: {data?.total ?? 0} tasks
        </div>
      </div>
    </div>
  );
}
