'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { DndContext, type DragEndEvent, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DEAL_STAGE_ORDER, DEAL_STAGE_LABELS, DEAL_STAGE_COLORS } from '@wacrm/shared';
import { cn, formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';

interface Deal {
  id: string;
  title: string;
  stage: string;
  value: number;
  currency: string;
  probability: number;
  contact: { id: string; displayName?: string; phoneNumber: string };
  updatedAt: string;
}

function DealCard({ deal }: { deal: Deal }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={cn(
        'bg-white rounded border border-gray-200 p-2 cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-50 shadow-md',
      )}
    >
      <p className="text-[11px] font-medium text-gray-900 mb-0.5 truncate">{deal.title}</p>
      <p className="text-[10px] text-gray-400 mb-1 truncate">{deal.contact?.displayName ?? deal.contact?.phoneNumber ?? '—'}</p>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-gray-900">{formatCurrency(deal.value * 100, deal.currency)}</span>
        <span className="text-[9px] text-gray-300">{deal.probability}%</span>
      </div>
    </div>
  );
}

export default function DealsPage() {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [stage, setStage] = useState('');
  const qc = useQueryClient();

  const { data: deals = [] } = useQuery({
    queryKey: ['deals'],
    queryFn: async () => {
      const res = await api.get<{ data: { items: Deal[] } }>('/deals');
      return res.data.data.items;
    },
  });

  const moveMutation = useMutation({
    mutationFn: async ({ dealId, stage }: { dealId: string; stage: string }) => {
      await api.patch(`/deals/${dealId}/stage`, { stage });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['deals'] }),
    onError: () => toast.error('Failed to move deal'),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/deals', { title, value: Number(value), stage }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['deals'] });
      toast.success('Deal created');
      setShowForm(false); setTitle(''); setValue(''); setStage('');
    },
    onError: () => toast.error('Failed to create deal'),
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const stage = over.id as string;
    if (DEAL_STAGE_ORDER.includes(stage as (typeof DEAL_STAGE_ORDER)[number])) {
      moveMutation.mutate({ dealId: active.id as string, stage });
    }
  };

  const dealsByStage = DEAL_STAGE_ORDER.reduce<Record<string, Deal[]>>((acc, stage) => {
    acc[stage] = deals.filter((d) => d.stage === stage);
    return acc;
  }, {});

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <span className="text-xs font-semibold text-gray-900">Deals Pipeline</span>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium">
          <Plus size={11} />
          Add
        </button>
      </div>

      {showForm && (
        <div className="border-b border-gray-200 bg-white p-3 space-y-2 shrink-0">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Deal title (required)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value" type="number" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <select value={stage} onChange={(e) => setStage(e.target.value)} className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400">
            <option value="">Select stage...</option>
            {DEAL_STAGE_ORDER.map((s) => <option key={s} value={s}>{DEAL_STAGE_LABELS[s]}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={() => createMutation.mutate()} disabled={!title} className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30">Create</button>
            <button onClick={() => setShowForm(false)} className="text-gray-400 text-[11px] px-2 py-1">Cancel</button>
          </div>
        </div>
      )}

      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex gap-2 overflow-x-auto p-3 flex-1">
          {DEAL_STAGE_ORDER.map((stage) => {
            const stageDeals = dealsByStage[stage] ?? [];
            const totalValue = stageDeals.reduce((s, d) => s + d.value, 0);

            return (
              <div key={stage} className="w-52 shrink-0 flex flex-col">
                <div className="flex items-center justify-between mb-2 px-1">
                  <div className="flex items-center gap-1.5">
                    <span className={cn('w-1.5 h-1.5 rounded-full', DEAL_STAGE_COLORS[stage])} />
                    <span className="text-[10px] font-semibold text-gray-600">{DEAL_STAGE_LABELS[stage]}</span>
                  </div>
                  <span className="text-[9px] text-gray-300">{stageDeals.length}</span>
                </div>

                {totalValue > 0 && (
                  <p className="text-[10px] text-gray-400 mb-1.5 px-1">{formatCurrency(totalValue * 100)}</p>
                )}

                <SortableContext items={stageDeals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
                  <div
                    id={stage}
                    className="flex-1 bg-gray-50/80 rounded-lg p-1.5 space-y-1.5 min-h-[80px] border border-dashed border-gray-200"
                  >
                    {stageDeals.map((deal) => (
                      <DealCard key={deal.id} deal={deal} />
                    ))}
                  </div>
                </SortableContext>
              </div>
            );
          })}
        </div>
      </DndContext>
    </div>
  );
}
