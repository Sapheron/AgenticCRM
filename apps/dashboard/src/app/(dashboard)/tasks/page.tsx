'use client';

/**
 * Tasks list page — filter rail + 5-tile stats strip + bulk-select toolbar
 * + view switcher (List ↔ Kanban ↔ My day) + click-through to detail.
 *
 * Mirrors the Leads/Deals upgrade pattern.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { cn, formatRelativeTime } from '@/lib/utils';
import {
  Plus, Search, X, Trash2, KanbanSquare, Table as TableIcon, Calendar,
  CheckSquare, AlertCircle, TrendingUp, Award, Clock, Repeat,
} from 'lucide-react';
import { toast } from 'sonner';
import { TaskKanban } from './kanban';

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  source: TaskSource;
  tags: string[];
  dueAt?: string;
  startedAt?: string;
  completedAt?: string;
  estimatedHours?: number;
  actualHours?: number;
  parentTaskId?: string;
  contact?: { id: string; displayName?: string; phoneNumber: string };
  deal?: { id: string; title: string; stage: string };
  lead?: { id: string; title: string; status: string };
  assignedAgent?: { id: string; firstName: string; lastName: string; avatarUrl?: string };
  subtasks?: Array<{ id: string; status: TaskStatus }>;
  _count?: { comments: number; watchers: number };
  updatedAt: string;
  createdAt: string;
}

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TaskSource = 'MANUAL' | 'AI_CHAT' | 'WHATSAPP' | 'RECURRING' | 'AUTO_FOLLOW_UP' | 'IMPORT' | 'OTHER';

interface Stats {
  rangeDays: number;
  total: number;
  byStatus: Record<string, number>;
  overdue: number;
  completedRecently: number;
  completionRate: number;
  avgCycleHours: number;
}

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  LOW: 'bg-gray-50 text-gray-500 border-gray-100',
  MEDIUM: 'bg-blue-50 text-blue-600 border-blue-100',
  HIGH: 'bg-orange-50 text-orange-600 border-orange-100',
  URGENT: 'bg-red-50 text-red-600 border-red-100',
};

export const STATUS_COLORS: Record<TaskStatus, string> = {
  TODO: 'bg-gray-50 text-gray-600 border-gray-100',
  IN_PROGRESS: 'bg-blue-50 text-blue-600 border-blue-100',
  DONE: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  CANCELLED: 'bg-red-50 text-red-500 border-red-100',
};

export const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
const PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const SOURCES: TaskSource[] = ['MANUAL', 'AI_CHAT', 'WHATSAPP', 'RECURRING', 'AUTO_FOLLOW_UP', 'IMPORT', 'OTHER'];

export default function TasksPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<'list' | 'kanban' | 'myday'>('list');
  const [filterStatus, setFilterStatus] = useState<TaskStatus | ''>('');
  const [filterPriority, setFilterPriority] = useState<TaskPriority | ''>('');
  const [filterSource, setFilterSource] = useState<TaskSource | ''>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [sort, setSort] = useState<'recent' | 'due' | 'priority' | 'created'>('due');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);

  useMemo(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // "My day" applies preset filters: due today + overdue, top-level only
  const isMyDay = view === 'myday';
  const startOfTomorrow = useMemo(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', { filterStatus, filterPriority, filterSource, debouncedSearch, overdue, assignedToMe, sort, view }],
    queryFn: async () => {
      const res = await api.get<{ data: { items: Task[]; total: number } }>('/tasks', {
        params: {
          status: filterStatus || undefined,
          priority: filterPriority || undefined,
          source: filterSource || undefined,
          search: debouncedSearch || undefined,
          overdue: overdue || undefined,
          assignedToMe: assignedToMe || isMyDay ? 'true' : undefined,
          dueTo: isMyDay ? startOfTomorrow : undefined,
          topLevel: 'true', // top-level tasks only — subtasks shown inside detail
          sort,
          limit: 200,
        },
      });
      return res.data.data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['task-stats'],
    queryFn: async () => {
      const r = await api.get<{ data: Stats }>('/tasks/stats', { params: { days: 30 } });
      return r.data.data;
    },
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/tasks/${id}/complete`),
    onSuccess: () => toast.success('Done'),
    onError: () => toast.error('Failed'),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: TaskStatus }) =>
      api.post('/tasks/bulk/status', { ids, status }),
    onSuccess: () => { setSelected(new Set()); toast.success('Updated'); },
  });

  const bulkSnoozeMutation = useMutation({
    mutationFn: ({ ids, minutes }: { ids: string[]; minutes: number }) =>
      api.post('/tasks/bulk/snooze', { ids, minutes }),
    onSuccess: () => { setSelected(new Set()); toast.success('Snoozed'); },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.post('/tasks/bulk/delete', { ids }),
    onSuccess: () => { setSelected(new Set()); toast.success('Deleted'); },
  });

  const items = data?.items ?? [];
  const allChecked = items.length > 0 && items.every((t) => selected.has(t.id));
  const toggleSelectAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(items.map((t) => t.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const clearFilters = () => {
    setFilterStatus(''); setFilterPriority(''); setFilterSource('');
    setSearch(''); setOverdue(false); setAssignedToMe(false);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-gray-900">Tasks</span>
          {data && <span className="text-[10px] text-gray-400">{data.total} total</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-gray-200 rounded overflow-hidden">
            <button onClick={() => setView('list')} className={cn('px-2 py-1 text-[10px]', view === 'list' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50')} title="List">
              <TableIcon size={11} />
            </button>
            <button onClick={() => setView('kanban')} className={cn('px-2 py-1 text-[10px]', view === 'kanban' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50')} title="Kanban">
              <KanbanSquare size={11} />
            </button>
            <button onClick={() => setView('myday')} className={cn('px-2 py-1 text-[10px]', view === 'myday' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50')} title="My day">
              <Calendar size={11} />
            </button>
          </div>
          <Link
            href="/tasks/recurrences"
            title="Recurring tasks"
            className="flex items-center gap-1 border border-gray-200 hover:border-violet-300 hover:bg-violet-50 text-gray-700 px-2.5 py-1 rounded text-[11px] font-medium"
          >
            <Repeat size={11} /> Recurring
          </Link>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium">
            <Plus size={11} /> New Task
          </button>
        </div>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="px-4 py-2 border-b border-gray-100 bg-white shrink-0 grid grid-cols-5 gap-3">
          <StatTile icon={<TrendingUp size={12} />} label="Open" value={String((stats.byStatus.TODO ?? 0) + (stats.byStatus.IN_PROGRESS ?? 0))} accent="text-violet-600" />
          <StatTile icon={<AlertCircle size={12} />} label="Overdue" value={String(stats.overdue)} accent="text-red-600" />
          <StatTile icon={<Award size={12} />} label="Done (30d)" value={String(stats.completedRecently)} accent="text-emerald-600" />
          <StatTile icon={<CheckSquare size={12} />} label="Completion" value={`${stats.completionRate}%`} accent="text-blue-600" />
          <StatTile icon={<Clock size={12} />} label="Avg cycle" value={`${stats.avgCycleHours}h`} accent="text-orange-600" />
        </div>
      )}

      {/* Filter rail */}
      <div className="border-b border-gray-100 bg-white shrink-0 px-3 py-2 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 border border-gray-200 rounded px-2 flex-1 max-w-xs">
          <Search size={11} className="text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, description, contact…" className="text-[11px] py-1 w-full focus:outline-none" />
        </div>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as TaskStatus | '')} className="text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value as TaskPriority | '')} className="text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filterSource} onChange={(e) => setFilterSource(e.target.value as TaskSource | '')} className="text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white">
          <option value="">All sources</option>
          {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as never)} className="text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white">
          <option value="due">Sort: Due</option>
          <option value="priority">Sort: Priority</option>
          <option value="recent">Sort: Recent</option>
          <option value="created">Sort: Created</option>
        </select>
        <label className="flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer">
          <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} className="h-3 w-3" />
          Overdue
        </label>
        <label className="flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer">
          <input type="checkbox" checked={assignedToMe} onChange={(e) => setAssignedToMe(e.target.checked)} className="h-3 w-3" />
          Assigned to me
        </label>
        {(filterStatus || filterPriority || filterSource || debouncedSearch || overdue || assignedToMe) && (
          <button onClick={clearFilters} className="text-[10px] text-gray-400 hover:text-gray-700 flex items-center gap-1">
            <X size={10} /> Clear
          </button>
        )}
      </div>

      {/* Bulk action toolbar */}
      {selected.size > 0 && (
        <div className="px-4 py-1.5 bg-violet-50 border-b border-violet-100 flex items-center gap-3 shrink-0">
          <span className="text-[11px] text-violet-700 font-medium">{selected.size} selected</span>
          <button
            onClick={() => bulkStatusMutation.mutate({ ids: [...selected], status: 'DONE' })}
            className="text-[10px] text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
          >
            <CheckSquare size={10} /> Mark done
          </button>
          <select
            onChange={(e) => {
              const minutes = Number(e.target.value);
              if (minutes) {
                bulkSnoozeMutation.mutate({ ids: [...selected], minutes });
                e.target.value = '';
              }
            }}
            className="text-[10px] border border-violet-200 rounded px-1.5 py-0.5 bg-white"
          >
            <option value="">Snooze…</option>
            <option value="60">1 hour</option>
            <option value="240">4 hours</option>
            <option value="1440">1 day</option>
            <option value="10080">1 week</option>
          </select>
          <button
            onClick={() => { if (confirm(`Delete ${selected.size} tasks?`)) bulkDeleteMutation.mutate([...selected]); }}
            className="text-[10px] text-red-600 hover:text-red-700 flex items-center gap-1"
          >
            <Trash2 size={10} /> Delete
          </button>
          <button onClick={() => setSelected(new Set())} className="text-[10px] text-gray-500 ml-auto">Clear</button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto bg-white">
        {view === 'kanban' ? (
          <TaskKanban
            tasks={items}
            onStatusChange={(id) => completeMutation.mutate(id)}
            onMove={(id, status) =>
              api.post(`/tasks/${id}/status`, { status }).then(() => {
                void qc.invalidateQueries({ queryKey: ['tasks'] });
              })
            }
          />
        ) : isLoading ? (
          <div className="p-8 text-center text-gray-300 text-xs">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center">
            <CheckSquare size={24} className="mx-auto text-gray-200 mb-2" />
            <p className="text-xs text-gray-300">No tasks match those filters.</p>
            <button onClick={clearFilters} className="text-[11px] text-violet-600 hover:text-violet-700 mt-2">Clear filters</button>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((task) => {
              const isOverdue = task.dueAt && new Date(task.dueAt) < new Date() && task.status !== 'DONE' && task.status !== 'CANCELLED';
              const subtasksTotal = task.subtasks?.length ?? 0;
              const subtasksDone = task.subtasks?.filter((s) => s.status === 'DONE').length ?? 0;
              return (
                <div key={task.id} className="flex items-start gap-2 px-3 py-2 hover:bg-gray-50/50 transition-colors">
                  <input
                    type="checkbox"
                    checked={selected.has(task.id)}
                    onChange={() => toggleOne(task.id)}
                    className="h-3 w-3 mt-1.5 shrink-0"
                  />
                  <button
                    onClick={() => completeMutation.mutate(task.id)}
                    className={cn(
                      'mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors',
                      task.status === 'DONE' ? 'border-violet-400 bg-violet-50' : 'border-gray-200 hover:border-violet-400',
                    )}
                  >
                    {task.status === 'DONE' && <div className="w-2 h-2 bg-violet-500 rounded-sm" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/tasks/${task.id}`} className={cn('text-xs font-medium text-gray-900 hover:text-violet-600', task.status === 'DONE' && 'line-through text-gray-400')}>
                        {task.title}
                      </Link>
                      <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium border shrink-0', PRIORITY_COLORS[task.priority])}>
                        {task.priority}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400 flex-wrap">
                      <span className={cn('px-1 py-px rounded', STATUS_COLORS[task.status])}>{task.status.replace('_', ' ')}</span>
                      {task.contact && <span>{task.contact.displayName ?? task.contact.phoneNumber}</span>}
                      {task.deal && <span>· {task.deal.title}</span>}
                      {task.dueAt && (
                        <span className={cn('flex items-center gap-0.5', isOverdue && 'text-red-600 font-medium')}>
                          {isOverdue && <AlertCircle size={8} />}
                          {formatRelativeTime(task.dueAt)}
                        </span>
                      )}
                      {subtasksTotal > 0 && (
                        <span className="text-gray-400">· {subtasksDone}/{subtasksTotal} subtasks</span>
                      )}
                      {(task._count?.comments ?? 0) > 0 && (
                        <span className="text-gray-400">· 💬 {task._count!.comments}</span>
                      )}
                      {task.tags.length > 0 && (
                        <span className="flex gap-1">
                          {task.tags.slice(0, 3).map((t) => (
                            <span key={t} className="text-[9px] bg-gray-100 text-gray-500 px-1 rounded">{t}</span>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={allChecked}
                    onChange={toggleSelectAll}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="h-9 border-t border-gray-200 px-3 flex items-center shrink-0 bg-white">
        <span className="text-[10px] text-gray-400">{data?.total ?? 0} tasks</span>
      </div>

      {showCreate && <CreateTaskModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function StatTile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <div className="border border-gray-100 rounded px-3 py-1.5">
      <div className="flex items-center gap-1 text-[9px] text-gray-400 uppercase tracking-wider">
        {icon} {label}
      </div>
      <div className={cn('text-sm font-semibold mt-0.5', accent)}>{value}</div>
    </div>
  );
}

function CreateTaskModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [reminderOffsets, setReminderOffsets] = useState('30');

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/tasks', {
        title,
        description: description || undefined,
        phoneNumber: phoneNumber || undefined,
        dueAt: dueAt || undefined,
        priority,
        reminderOffsets: reminderOffsets
          .split(',')
          .map((v) => Number(v.trim()))
          .filter((n) => !Number.isNaN(n) && n > 0),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['task-stats'] });
      toast.success('Task created');
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err && typeof err === 'object' && 'response' in err
        ? ((err as { response?: { data?: { message?: string } } }).response?.data?.message)
        : null) ?? 'Failed to create';
      toast.error(msg);
    },
  });

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[460px] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold">New Task</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title (required)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={2} className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none" />
        <input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="Link contact phone (optional)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs" />
        <div className="grid grid-cols-2 gap-2">
          <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="border border-gray-200 rounded px-2.5 py-1.5 text-xs" />
          <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white">
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <input value={reminderOffsets} onChange={(e) => setReminderOffsets(e.target.value)} placeholder="Reminder offsets in minutes (comma, e.g. 60, 30, 5)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs" />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-gray-500 text-[11px] px-2 py-1">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!title || mutation.isPending}
            className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30"
          >
            {mutation.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
