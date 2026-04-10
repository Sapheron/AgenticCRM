'use client';

/**
 * Deals list page — keeps the existing @dnd-kit kanban + adds:
 *  - 5-tile forecast strip (raw vs weighted pipeline, won, conversion, cycle)
 *  - Filter rail (stage, source, priority, search, value/probability ranges)
 *  - Table view with bulk-select toolbar
 *  - View switcher (kanban ↔ table)
 *  - Click-through cards → /deals/[id]
 *  - Inline create modal with contact picker
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { DndContext, type DragEndEvent, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DEAL_STAGE_ORDER, DEAL_STAGE_LABELS, DEAL_STAGE_COLORS } from '@wacrm/shared';
import { cn, formatCurrency, formatRelativeTime } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Plus, Search, X, Trash2, KanbanSquare, Table as TableIcon,
  TrendingUp, Award, Flame, Clock, Activity,
} from 'lucide-react';

export interface Deal {
  id: string;
  title: string;
  stage: DealStage;
  source: DealSource;
  priority: DealPriority;
  value: number;
  currency: string;
  probability: number;
  weightedValue?: number;
  tags: string[];
  expectedCloseAt?: string;
  nextActionAt?: string;
  contact: { id: string; displayName?: string; phoneNumber: string };
  assignedAgent?: { id: string; firstName: string; lastName: string; avatarUrl?: string };
  lead?: { id: string; title: string };
  updatedAt: string;
  createdAt: string;
}

export type DealStage = 'LEAD_IN' | 'QUALIFIED' | 'PROPOSAL' | 'NEGOTIATION' | 'WON' | 'LOST';
export type DealSource = 'LEAD_CONVERSION' | 'WHATSAPP' | 'MANUAL' | 'AI_CHAT' | 'REFERRAL' | 'CAMPAIGN' | 'WEBSITE' | 'IMPORT' | 'OTHER';
export type DealPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

interface Forecast {
  rangeDays: number;
  totalDeals: number;
  openDeals: number;
  pipelineValueRaw: number;
  pipelineValueWeighted: number;
  wonValue: number;
  wonCount: number;
  lostValue: number;
  lostCount: number;
  conversionRate: number;
  avgSalesCycleDays: number;
  byStage: Record<DealStage, { count: number; value: number; weighted: number }>;
}

const SOURCES: DealSource[] = ['LEAD_CONVERSION', 'WHATSAPP', 'MANUAL', 'AI_CHAT', 'REFERRAL', 'CAMPAIGN', 'WEBSITE', 'IMPORT', 'OTHER'];
const PRIORITIES: DealPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const PRIORITY_DOTS: Record<DealPriority, string> = {
  LOW: 'bg-gray-300',
  MEDIUM: 'bg-blue-400',
  HIGH: 'bg-orange-400',
  URGENT: 'bg-red-500',
};

// ── Sortable kanban card ───────────────────────────────────────────────────

function DealCard({ deal }: { deal: Deal }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'bg-white rounded border border-gray-200 p-2 hover:border-violet-300 hover:shadow-sm transition-all',
        isDragging && 'opacity-50 shadow-md',
      )}
    >
      <div className="flex items-start gap-1 mb-0.5">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing shrink-0 mt-0.5"
          aria-label="Drag"
        >
          <span className={cn('block w-1.5 h-1.5 rounded-full', PRIORITY_DOTS[deal.priority])} />
        </button>
        <Link href={`/deals/${deal.id}`} className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-gray-900 truncate hover:text-violet-600">{deal.title}</p>
          <p className="text-[10px] text-gray-400 truncate">{deal.contact?.displayName ?? deal.contact?.phoneNumber ?? '—'}</p>
        </Link>
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[11px] font-semibold text-gray-900">
          {deal.currency} {deal.value.toLocaleString()}
        </span>
        <span className="text-[9px] text-gray-400">{deal.probability}%</span>
      </div>
      {deal.tags.length > 0 && (
        <div className="flex gap-1 mt-1 flex-wrap">
          {deal.tags.slice(0, 2).map((t) => (
            <span key={t} className="text-[8px] bg-gray-100 text-gray-500 px-1 rounded">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function DealsPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<'kanban' | 'table'>('kanban');
  const [filterStage, setFilterStage] = useState<DealStage | ''>('');
  const [filterSource, setFilterSource] = useState<DealSource | ''>('');
  const [filterPriority, setFilterPriority] = useState<DealPriority | ''>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [valueMin, setValueMin] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useMemo(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data } = useQuery({
    queryKey: ['deals', { filterStage, filterSource, filterPriority, debouncedSearch, valueMin }],
    queryFn: async () => {
      const res = await api.get<{ data: { items: Deal[]; total: number } }>('/deals', {
        params: {
          stage: filterStage || undefined,
          source: filterSource || undefined,
          priority: filterPriority || undefined,
          search: debouncedSearch || undefined,
          valueMin: valueMin || undefined,
          limit: 200,
        },
      });
      return res.data.data;
    },
  });

  const { data: forecast } = useQuery({
    queryKey: ['deal-forecast'],
    queryFn: async () => {
      const r = await api.get<{ data: Forecast }>('/deals/forecast', { params: { days: 30 } });
      return r.data.data;
    },
  });

  const moveMutation = useMutation({
    mutationFn: ({ dealId, stage }: { dealId: string; stage: DealStage }) =>
      api.post(`/deals/${dealId}/stage`, { stage }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['deals'] });
      void qc.invalidateQueries({ queryKey: ['deal-forecast'] });
    },
    onError: (err: unknown) => {
      const msg = (err && typeof err === 'object' && 'response' in err
        ? ((err as { response?: { data?: { message?: string } } }).response?.data?.message)
        : null) ?? 'Failed to move deal';
      toast.error(msg);
    },
  });

  const bulkStageMutation = useMutation({
    mutationFn: ({ ids, stage }: { ids: string[]; stage: DealStage }) =>
      api.post('/deals/bulk/stage', { ids, stage }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['deals'] });
      void qc.invalidateQueries({ queryKey: ['deal-forecast'] });
      setSelected(new Set());
      toast.success('Bulk update applied');
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.post('/deals/bulk/delete', { ids }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['deals'] });
      void qc.invalidateQueries({ queryKey: ['deal-forecast'] });
      setSelected(new Set());
      toast.success('Deleted');
    },
  });

  const items = data?.items ?? [];

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const stage = over.id as DealStage;
    if (DEAL_STAGE_ORDER.includes(stage as (typeof DEAL_STAGE_ORDER)[number])) {
      moveMutation.mutate({ dealId: active.id as string, stage });
    }
  };

  const dealsByStage = DEAL_STAGE_ORDER.reduce<Record<string, Deal[]>>((acc, stage) => {
    acc[stage] = items.filter((d) => d.stage === stage);
    return acc;
  }, {});

  const allChecked = items.length > 0 && items.every((d) => selected.has(d.id));
  const toggleSelectAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(items.map((d) => d.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const clearFilters = () => {
    setFilterStage(''); setFilterSource(''); setFilterPriority('');
    setSearch(''); setValueMin('');
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-gray-900">Deals Pipeline</span>
          {data && <span className="text-[10px] text-gray-400">{data.total} total</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-gray-200 rounded overflow-hidden">
            <button onClick={() => setView('kanban')} className={cn('px-2 py-1 text-[10px]', view === 'kanban' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50')}>
              <KanbanSquare size={11} />
            </button>
            <button onClick={() => setView('table')} className={cn('px-2 py-1 text-[10px]', view === 'table' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50')}>
              <TableIcon size={11} />
            </button>
          </div>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium">
            <Plus size={11} /> New Deal
          </button>
        </div>
      </div>

      {/* Forecast strip */}
      {forecast && (
        <div className="px-4 py-2 border-b border-gray-100 bg-white shrink-0 grid grid-cols-5 gap-3">
          <StatTile icon={<TrendingUp size={12} />} label="Pipeline (raw)" value={`₹${Math.round(forecast.pipelineValueRaw).toLocaleString()}`} accent="text-violet-600" />
          <StatTile icon={<Activity size={12} />} label="Pipeline (wgt)" value={`₹${Math.round(forecast.pipelineValueWeighted).toLocaleString()}`} accent="text-violet-600" />
          <StatTile icon={<Award size={12} />} label="Won (30d)" value={`${forecast.wonCount} · ₹${Math.round(forecast.wonValue).toLocaleString()}`} accent="text-emerald-600" />
          <StatTile icon={<Flame size={12} />} label="Conv. rate" value={`${forecast.conversionRate}%`} accent="text-orange-600" />
          <StatTile icon={<Clock size={12} />} label="Avg cycle" value={`${forecast.avgSalesCycleDays}d`} accent="text-blue-600" />
        </div>
      )}

      {/* Filter rail */}
      <div className="border-b border-gray-100 bg-white shrink-0 px-3 py-2 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 border border-gray-200 rounded px-2 flex-1 max-w-xs">
          <Search size={11} className="text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, contact, notes…" className="text-[11px] py-1 w-full focus:outline-none" />
        </div>
        <select value={filterStage} onChange={(e) => setFilterStage(e.target.value as DealStage | '')} className="text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white">
          <option value="">All stages</option>
          {DEAL_STAGE_ORDER.map((s) => <option key={s} value={s}>{DEAL_STAGE_LABELS[s]}</option>)}
        </select>
        <select value={filterSource} onChange={(e) => setFilterSource(e.target.value as DealSource | '')} className="text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white">
          <option value="">All sources</option>
          {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value as DealPriority | '')} className="text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input type="number" value={valueMin} onChange={(e) => setValueMin(e.target.value)} placeholder="Min value" className="text-[10px] border border-gray-200 rounded px-1.5 py-1 w-20" />
        {(filterStage || filterSource || filterPriority || debouncedSearch || valueMin) && (
          <button onClick={clearFilters} className="text-[10px] text-gray-400 hover:text-gray-700 flex items-center gap-1">
            <X size={10} /> Clear
          </button>
        )}
      </div>

      {/* Bulk action toolbar */}
      {selected.size > 0 && (
        <div className="px-4 py-1.5 bg-violet-50 border-b border-violet-100 flex items-center gap-3 shrink-0">
          <span className="text-[11px] text-violet-700 font-medium">{selected.size} selected</span>
          <select
            onChange={(e) => {
              if (e.target.value) {
                bulkStageMutation.mutate({ ids: [...selected], stage: e.target.value as DealStage });
                e.target.value = '';
              }
            }}
            className="text-[10px] border border-violet-200 rounded px-1.5 py-0.5 bg-white"
          >
            <option value="">Move to stage…</option>
            {DEAL_STAGE_ORDER.map((s) => <option key={s} value={s}>{DEAL_STAGE_LABELS[s]}</option>)}
          </select>
          <button
            onClick={() => { if (confirm(`Delete ${selected.size} deals?`)) bulkDeleteMutation.mutate([...selected]); }}
            className="text-[10px] text-red-600 hover:text-red-700 flex items-center gap-1"
          >
            <Trash2 size={10} /> Delete
          </button>
          <button onClick={() => setSelected(new Set())} className="text-[10px] text-gray-500 ml-auto">Clear</button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {view === 'kanban' ? (
          <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <div className="flex gap-2 overflow-x-auto p-3 h-full">
              {DEAL_STAGE_ORDER.map((stage) => {
                const stageDeals = dealsByStage[stage] ?? [];
                const totalValue = stageDeals.reduce((s, d) => s + d.value, 0);
                const weighted = stageDeals.reduce((s, d) => s + d.value * (d.probability / 100), 0);
                return (
                  <div key={stage} className="w-56 shrink-0 flex flex-col">
                    <div className="flex items-center justify-between mb-2 px-1">
                      <div className="flex items-center gap-1.5">
                        <span className={cn('w-1.5 h-1.5 rounded-full', DEAL_STAGE_COLORS[stage])} />
                        <span className="text-[10px] font-semibold text-gray-600">{DEAL_STAGE_LABELS[stage]}</span>
                      </div>
                      <span className="text-[9px] text-gray-300">{stageDeals.length}</span>
                    </div>
                    {totalValue > 0 && (
                      <p className="text-[10px] text-gray-400 mb-1.5 px-1">
                        ₹{totalValue.toLocaleString()} <span className="text-gray-300">· wgt ₹{Math.round(weighted).toLocaleString()}</span>
                      </p>
                    )}
                    <SortableContext items={stageDeals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
                      <div id={stage} className="flex-1 bg-gray-50/80 rounded-lg p-1.5 space-y-1.5 min-h-[80px] border border-dashed border-gray-200">
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
        ) : items.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-xs text-gray-400 mb-2">No deals match those filters.</p>
            <button onClick={clearFilters} className="text-[11px] text-violet-600 hover:text-violet-700">Clear filters</button>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200 sticky top-0">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input type="checkbox" checked={allChecked} onChange={toggleSelectAll} className="h-3 w-3" />
                </th>
                {['Deal', 'Contact', 'Stage', 'Value', 'Prob', 'Source', 'Updated'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {items.map((deal) => (
                <tr key={deal.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(deal.id)} onChange={() => toggleOne(deal.id)} className="h-3 w-3" />
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/deals/${deal.id}`} className="text-xs font-medium text-gray-900 hover:text-violet-600 flex items-center gap-1.5">
                      <span className={cn('w-1.5 h-1.5 rounded-full', PRIORITY_DOTS[deal.priority])} />
                      {deal.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {deal.contact?.displayName ?? deal.contact?.phoneNumber ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', 'bg-gray-50 text-gray-600 border border-gray-100')}>
                      {DEAL_STAGE_LABELS[deal.stage as keyof typeof DEAL_STAGE_LABELS]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs font-semibold text-gray-900">
                    {deal.currency} {deal.value.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{deal.probability}%</td>
                  <td className="px-3 py-2 text-[11px] text-gray-400">{deal.source}</td>
                  <td className="px-3 py-2 text-[10px] text-gray-300">{formatRelativeTime(deal.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="h-9 border-t border-gray-200 px-3 flex items-center shrink-0 bg-white">
        <span className="text-[10px] text-gray-400">{data?.total ?? 0} deals</span>
      </div>

      {showCreate && <CreateDealModal onClose={() => setShowCreate(false)} />}
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

function CreateDealModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [contactName, setContactName] = useState('');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [stage, setStage] = useState<DealStage>('LEAD_IN');
  const [source, setSource] = useState<DealSource>('MANUAL');
  const [priority, setPriority] = useState<DealPriority>('MEDIUM');
  const [expectedCloseAt, setExpectedCloseAt] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/deals', {
        title,
        value: Number(value || 0),
        currency,
        stage,
        source,
        priority,
        phoneNumber: phoneNumber || undefined,
        contactName: contactName || undefined,
        expectedCloseAt: expectedCloseAt || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['deals'] });
      void qc.invalidateQueries({ queryKey: ['deal-forecast'] });
      toast.success('Deal created');
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
          <h3 className="text-xs font-semibold">New Deal</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Deal title (required)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
        <div className="grid grid-cols-2 gap-2">
          <input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="Contact phone" className="border border-gray-200 rounded px-2.5 py-1.5 text-xs" />
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Contact name (opt)" className="border border-gray-200 rounded px-2.5 py-1.5 text-xs" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex gap-1">
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-12 border border-gray-200 rounded px-2 py-1.5 text-xs" />
            <input value={value} onChange={(e) => setValue(e.target.value)} type="number" placeholder="Value" className="flex-1 border border-gray-200 rounded px-2.5 py-1.5 text-xs" />
          </div>
          <input type="date" value={expectedCloseAt} onChange={(e) => setExpectedCloseAt(e.target.value)} className="border border-gray-200 rounded px-2.5 py-1.5 text-xs" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <select value={stage} onChange={(e) => setStage(e.target.value as DealStage)} className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white">
            {DEAL_STAGE_ORDER.filter((s) => s !== 'WON' && s !== 'LOST').map((s) => <option key={s} value={s}>{DEAL_STAGE_LABELS[s]}</option>)}
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value as DealSource)} className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white">
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value as DealPriority)} className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white">
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-gray-500 text-[11px] px-2 py-1">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!title || !value || mutation.isPending}
            className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30"
          >
            {mutation.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
