'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { DndContext, type DragEndEvent, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DEAL_STAGE_ORDER, DEAL_STAGE_LABELS, DEAL_STAGE_COLORS } from '@wacrm/shared';
import { cn, formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';

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
        'bg-white rounded-lg border border-gray-200 p-3 cursor-grab active:cursor-grabbing shadow-sm',
        isDragging && 'opacity-50 shadow-lg',
      )}
    >
      <p className="text-sm font-medium text-gray-900 mb-1">{deal.title}</p>
      <p className="text-xs text-gray-500 mb-2">{deal.contact.displayName ?? deal.contact.phoneNumber}</p>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-green-700">{formatCurrency(deal.value * 100, deal.currency)}</span>
        <span className="text-xs text-gray-400">{deal.probability}%</span>
      </div>
    </div>
  );
}

export default function DealsPage() {
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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // over.id is the column stage when dropped into empty column
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
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Deals Pipeline</h1>
        <button className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          + New Deal
        </button>
      </div>

      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4 flex-1">
          {DEAL_STAGE_ORDER.map((stage) => {
            const stageDeals = dealsByStage[stage] ?? [];
            const totalValue = stageDeals.reduce((s, d) => s + d.value, 0);

            return (
              <div key={stage} className="w-64 shrink-0 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={cn('w-2 h-2 rounded-full', DEAL_STAGE_COLORS[stage])} />
                    <h3 className="text-sm font-semibold text-gray-700">{DEAL_STAGE_LABELS[stage]}</h3>
                  </div>
                  <span className="text-xs text-gray-400">{stageDeals.length}</span>
                </div>

                {totalValue > 0 && (
                  <p className="text-xs text-gray-500 mb-2">{formatCurrency(totalValue * 100)}</p>
                )}

                <SortableContext items={stageDeals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
                  <div
                    id={stage}
                    className="flex-1 bg-gray-50 rounded-xl p-2 space-y-2 min-h-32 border-2 border-dashed border-transparent"
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
