'use client';

/**
 * Tasks → Recurrences management page.
 *
 * Lists every TaskRecurrence row, lets the user pause/resume/delete, and
 * exposes a "+ New recurring task" modal that creates a series with the
 * frequency rules + template fields.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { toast } from 'sonner';
import { cn, formatRelativeTime } from '@/lib/utils';
import { ArrowLeft, Plus, Trash2, Power, PowerOff, Repeat, X } from 'lucide-react';

interface Recurrence {
  id: string;
  templateTitle: string;
  templateBody?: string;
  templatePriority: string;
  frequency: string;
  intervalDays?: number;
  daysOfWeek: number[];
  dayOfMonth?: number;
  startsAt: string;
  endsAt?: string;
  nextRunAt: string;
  lastRunAt?: string;
  totalGenerated: number;
  isActive: boolean;
  createdAt: string;
}

const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM_DAYS'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function TaskRecurrencesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: items } = useQuery({
    queryKey: ['task-recurrences'],
    queryFn: async () => {
      const r = await api.get<{ data: Recurrence[] }>('/task-recurrences');
      return r.data.data;
    },
  });

  const pauseMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' }) =>
      api.post(`/task-recurrences/${id}/${action}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['task-recurrences'] }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/task-recurrences/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['task-recurrences'] }); toast.success('Removed'); },
  });

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/tasks')} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft size={14} />
          </button>
          <Repeat size={14} className="text-violet-500" />
          <span className="text-xs font-semibold text-gray-900">Recurring Tasks</span>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium"
        >
          <Plus size={11} /> New Recurring Task
        </button>
      </div>

      <div className="flex-1 overflow-auto bg-gray-50/50 p-4">
        {!items?.length ? (
          <div className="bg-white border border-gray-200 rounded-lg p-12 text-center max-w-2xl mx-auto">
            <Repeat size={32} className="mx-auto text-gray-200 mb-3" />
            <p className="text-xs text-gray-400 mb-2">No recurring tasks set up yet.</p>
            <p className="text-[11px] text-gray-300 mb-4">
              Create one for daily standups, weekly reviews, monthly closes — anything that should auto-generate
              a fresh task on a schedule.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="text-[11px] bg-gray-900 text-white px-4 py-1.5 rounded hover:bg-gray-800"
            >
              + New Recurring Task
            </button>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden max-w-4xl mx-auto">
            <table className="w-full">
              <thead className="bg-gray-50/80 border-b border-gray-200">
                <tr>
                  {['Title', 'Frequency', 'Next run', 'Generated', 'Status', ''].map((h) => (
                    <th key={h} className="text-left px-3 py-2 text-[10px] font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((r) => (
                  <tr key={r.id} className={cn('hover:bg-gray-50/50', !r.isActive && 'opacity-50')}>
                    <td className="px-3 py-2">
                      <div className="text-xs font-medium text-gray-900">{r.templateTitle}</div>
                      {r.templateBody && <div className="text-[10px] text-gray-400 truncate max-w-xs">{r.templateBody}</div>}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-gray-600">
                      {r.frequency}
                      {r.frequency === 'WEEKLY' && r.daysOfWeek.length > 0 && (
                        <span className="text-[10px] text-gray-400 ml-1">({r.daysOfWeek.map((d) => DAYS[d]).join(', ')})</span>
                      )}
                      {r.frequency === 'MONTHLY' && r.dayOfMonth && (
                        <span className="text-[10px] text-gray-400 ml-1">(day {r.dayOfMonth})</span>
                      )}
                      {r.frequency === 'CUSTOM_DAYS' && r.intervalDays && (
                        <span className="text-[10px] text-gray-400 ml-1">(every {r.intervalDays}d)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-gray-600">{formatRelativeTime(r.nextRunAt)}</td>
                    <td className="px-3 py-2 text-[11px] text-gray-600">{r.totalGenerated}</td>
                    <td className="px-3 py-2">
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded font-medium',
                        r.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500',
                      )}>
                        {r.isActive ? 'Active' : 'Paused'}
                      </span>
                    </td>
                    <td className="px-3 py-2 flex items-center justify-end gap-1">
                      <button
                        onClick={() => pauseMutation.mutate({ id: r.id, action: r.isActive ? 'pause' : 'resume' })}
                        className="text-gray-400 hover:text-violet-500"
                        title={r.isActive ? 'Pause' : 'Resume'}
                      >
                        {r.isActive ? <Power size={11} /> : <PowerOff size={11} />}
                      </button>
                      <button
                        onClick={() => { if (confirm(`Remove recurring task "${r.templateTitle}"?`)) deleteMutation.mutate(r.id); }}
                        className="text-gray-400 hover:text-red-500"
                      >
                        <Trash2 size={11} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && <CreateRecurrenceModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function CreateRecurrenceModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [templateTitle, setTitle] = useState('');
  const [templateBody, setBody] = useState('');
  const [templatePriority, setPriority] = useState('MEDIUM');
  const [frequency, setFrequency] = useState<string>('DAILY');
  const [intervalDays, setIntervalDays] = useState('');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [dayOfMonth, setDayOfMonth] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/task-recurrences', {
        templateTitle,
        templateBody: templateBody || undefined,
        templatePriority,
        frequency,
        intervalDays: intervalDays ? Number(intervalDays) : undefined,
        daysOfWeek,
        dayOfMonth: dayOfMonth ? Number(dayOfMonth) : undefined,
        startsAt,
        endsAt: endsAt || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['task-recurrences'] });
      toast.success('Recurring task created');
      onClose();
    },
    onError: () => toast.error('Failed to create'),
  });

  const toggleDay = (d: number) => {
    setDaysOfWeek((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[480px] p-4 space-y-3 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-xs font-semibold">New Recurring Task</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
        </div>

        <input value={templateTitle} onChange={(e) => setTitle(e.target.value)} placeholder="Task title (required)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
        <textarea value={templateBody} onChange={(e) => setBody(e.target.value)} placeholder="Description (optional)" rows={2} className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs resize-none" />

        <div className="grid grid-cols-2 gap-2">
          <select value={templatePriority} onChange={(e) => setPriority(e.target.value)} className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white">
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white">
            {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>

        {frequency === 'WEEKLY' && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">Days of week</p>
            <div className="flex gap-1">
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={cn(
                    'text-[10px] px-2 py-1 rounded border',
                    daysOfWeek.includes(i)
                      ? 'bg-violet-100 text-violet-700 border-violet-300'
                      : 'bg-white text-gray-500 border-gray-200',
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}

        {frequency === 'MONTHLY' && (
          <input type="number" min="1" max="31" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} placeholder="Day of month (1-31)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs" />
        )}

        {frequency === 'CUSTOM_DAYS' && (
          <input type="number" min="1" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} placeholder="Every N days" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs" />
        )}

        <div>
          <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">Starts at</p>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs" />
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">Ends at (optional)</p>
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs" />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-gray-500 text-[11px] px-2 py-1">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!templateTitle || !startsAt || mutation.isPending}
            className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30"
          >
            {mutation.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
