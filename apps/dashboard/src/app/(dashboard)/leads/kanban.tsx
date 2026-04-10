'use client';

/**
 * Kanban view for the Leads list. Cards group by status; drag-drop a card to
 * a different column to move the lead through the pipeline (calls
 * `onStatusChange`, which the parent wires to the status-update mutation).
 *
 * Uses native HTML5 drag-and-drop — no extra dependency.
 */

import { useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { STATUSES, STATUS_COLORS, type Lead, type LeadStatus } from './page';

interface KanbanProps {
  leads: Lead[];
  onStatusChange: (id: string, status: LeadStatus) => void;
}

const PRIORITY_DOTS: Record<string, string> = {
  LOW: 'bg-gray-300',
  MEDIUM: 'bg-blue-400',
  HIGH: 'bg-orange-400',
  URGENT: 'bg-red-500',
};

export function LeadKanban({ leads, onStatusChange }: KanbanProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<LeadStatus | null>(null);

  const grouped: Record<LeadStatus, Lead[]> = {
    NEW: [], CONTACTED: [], QUALIFIED: [], PROPOSAL_SENT: [],
    NEGOTIATING: [], WON: [], LOST: [], DISQUALIFIED: [],
  };
  for (const l of leads) grouped[l.status]?.push(l);

  return (
    <div className="h-full overflow-x-auto">
      <div className="flex gap-3 p-3 min-h-full" style={{ width: 'max-content' }}>
        {STATUSES.map((status) => (
          <div
            key={status}
            onDragOver={(e) => { e.preventDefault(); setHoverCol(status); }}
            onDragLeave={() => setHoverCol((c) => (c === status ? null : c))}
            onDrop={() => {
              if (draggedId) {
                const lead = leads.find((l) => l.id === draggedId);
                if (lead && lead.status !== status) onStatusChange(draggedId, status);
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
                {status.replace('_', ' ')}
              </span>
              <span className="text-[10px] text-gray-400">{grouped[status].length}</span>
            </div>
            <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-260px)]">
              {grouped[status].map((lead) => (
                <div
                  key={lead.id}
                  draggable
                  onDragStart={() => setDraggedId(lead.id)}
                  onDragEnd={() => setDraggedId(null)}
                  className={cn(
                    'bg-white rounded border border-gray-200 p-2 cursor-grab active:cursor-grabbing hover:border-violet-300 hover:shadow-sm transition-all',
                    draggedId === lead.id && 'opacity-50',
                  )}
                >
                  <Link href={`/leads/${lead.id}`} className="block">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', PRIORITY_DOTS[lead.priority])} />
                      <span className="text-[11px] font-medium text-gray-900 truncate">{lead.title}</span>
                    </div>
                    <div className="text-[10px] text-gray-500 truncate mb-1.5">
                      {lead.contact?.displayName ?? lead.contact?.phoneNumber ?? '—'}
                    </div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="flex-1 bg-gray-100 rounded-full h-1">
                        <div
                          className={cn('h-1 rounded-full', lead.score >= 70 ? 'bg-emerald-500' : lead.score >= 40 ? 'bg-violet-500' : 'bg-gray-300')}
                          style={{ width: `${lead.score}%` }}
                        />
                      </div>
                      <span className="text-[9px] text-gray-400">{lead.score}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      {lead.estimatedValue ? (
                        <span className="text-[10px] text-emerald-600 font-medium">
                          ₹{lead.estimatedValue.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-300">—</span>
                      )}
                      <span className={cn('text-[9px] px-1 py-px rounded', STATUS_COLORS[lead.status])}>
                        {lead.priority}
                      </span>
                    </div>
                  </Link>
                </div>
              ))}
              {grouped[status].length === 0 && (
                <div className="text-[10px] text-gray-300 text-center py-3">No leads</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
