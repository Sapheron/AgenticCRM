'use client';

/**
 * Kanban view for the Tasks list. Columns = TaskStatus enum (TODO,
 * IN_PROGRESS, DONE — CANCELLED hidden by default). Drag-drop a card to a
 * different column to move the task through the lifecycle. Native HTML5
 * drag-and-drop, no extra dependency.
 */

import { useState } from 'react';
import Link from 'next/link';
import { cn, formatRelativeTime } from '@/lib/utils';
import { AlertCircle } from 'lucide-react';
import { PRIORITY_COLORS, type Task, type TaskStatus } from './page';

const COLUMNS: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE'];

const COLUMN_LABELS: Record<TaskStatus, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};

interface Props {
  tasks: Task[];
  onStatusChange: (id: string) => void;
  onMove: (id: string, status: TaskStatus) => void;
}

export function TaskKanban({ tasks, onMove }: Props) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<TaskStatus | null>(null);

  const grouped: Record<TaskStatus, Task[]> = {
    TODO: [], IN_PROGRESS: [], DONE: [], CANCELLED: [],
  };
  for (const t of tasks) grouped[t.status]?.push(t);

  return (
    <div className="h-full overflow-x-auto">
      <div className="flex gap-3 p-3 min-h-full" style={{ width: 'max-content' }}>
        {COLUMNS.map((status) => (
          <div
            key={status}
            onDragOver={(e) => { e.preventDefault(); setHoverCol(status); }}
            onDragLeave={() => setHoverCol((c) => (c === status ? null : c))}
            onDrop={() => {
              if (draggedId) {
                const task = tasks.find((t) => t.id === draggedId);
                if (task && task.status !== status) onMove(draggedId, status);
              }
              setDraggedId(null);
              setHoverCol(null);
            }}
            className={cn(
              'w-64 shrink-0 rounded-lg border bg-gray-50/50 flex flex-col',
              hoverCol === status ? 'border-violet-300 bg-violet-50/50' : 'border-gray-200',
            )}
          >
            <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
              <span className="text-[10px] font-semibold text-gray-700 uppercase tracking-wider">
                {COLUMN_LABELS[status]}
              </span>
              <span className="text-[10px] text-gray-400">{grouped[status].length}</span>
            </div>
            <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-260px)]">
              {grouped[status].map((task) => {
                const isOverdue = task.dueAt && new Date(task.dueAt) < new Date() && task.status !== 'DONE';
                return (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => setDraggedId(task.id)}
                    onDragEnd={() => setDraggedId(null)}
                    className={cn(
                      'bg-white rounded border border-gray-200 p-2 cursor-grab active:cursor-grabbing hover:border-violet-300 hover:shadow-sm transition-all',
                      draggedId === task.id && 'opacity-50',
                    )}
                  >
                    <Link href={`/tasks/${task.id}`} className="block">
                      <div className="flex items-start justify-between gap-1.5 mb-1">
                        <span className="text-[11px] font-medium text-gray-900 truncate flex-1">{task.title}</span>
                        <span className={cn('text-[9px] px-1 py-px rounded font-medium border shrink-0', PRIORITY_COLORS[task.priority])}>
                          {task.priority}
                        </span>
                      </div>
                      {task.contact && (
                        <div className="text-[10px] text-gray-500 truncate mb-1">
                          {task.contact.displayName ?? task.contact.phoneNumber}
                        </div>
                      )}
                      {task.dueAt && (
                        <div className={cn('flex items-center gap-1 text-[10px]', isOverdue ? 'text-red-600 font-medium' : 'text-gray-400')}>
                          {isOverdue && <AlertCircle size={9} />}
                          {formatRelativeTime(task.dueAt)}
                        </div>
                      )}
                      {(task.subtasks?.length ?? 0) > 0 && (
                        <div className="text-[10px] text-gray-400 mt-1">
                          {task.subtasks!.filter((s) => s.status === 'DONE').length}/{task.subtasks!.length} subtasks
                        </div>
                      )}
                    </Link>
                  </div>
                );
              })}
              {grouped[status].length === 0 && (
                <div className="text-[10px] text-gray-300 text-center py-3">No tasks</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
