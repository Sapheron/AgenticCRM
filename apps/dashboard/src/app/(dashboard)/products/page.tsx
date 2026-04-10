'use client';

/**
 * Products list page — filter rail + 5-tile catalog stats + bulk-select
 * toolbar + click-through to detail. Mirrors the leads/deals/tasks pattern
 * but adapted for catalog management (no lifecycle, no scoring — instead
 * inventory + variants + categories).
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  Plus, Search, X, Trash2, Package, AlertCircle, TrendingUp,
  Archive, ArchiveRestore,
} from 'lucide-react';
import { toast } from 'sonner';

export interface Product {
  id: string;
  name: string;
  description?: string;
  price: number;
  costPrice?: number;
  currency: string;
  sku?: string;
  barcode?: string;
  category?: string;
  tags: string[];
  trackInventory: boolean;
  stock: number;
  reorderLevel: number;
  images: string[];
  variants: unknown[];
  isActive: boolean;
  archivedAt?: string;
  totalSold: number;
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  total: number;
  active: number;
  archived: number;
  lowStock: number;
  outOfStock: number;
  byCategory: Record<string, number>;
  catalogValue: number;
}

export default function ProductsPage() {
  // Global query client subscription handles invalidation after mutations.
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState<'active' | 'inactive' | 'archived' | ''>('');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sort, setSort] = useState<'recent' | 'name' | 'price' | 'stock' | 'sold'>('recent');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);

  useMemo(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ['products', { filterCategory, filterStatus, debouncedSearch, inStockOnly, sort }],
    queryFn: async () => {
      const res = await api.get<{ data: { items: Product[]; total: number } }>('/products', {
        params: {
          isActive: filterStatus === 'active' ? 'true' : filterStatus === 'inactive' ? 'false' : undefined,
          archived: filterStatus === 'archived' ? 'true' : undefined,
          category: filterCategory || undefined,
          search: debouncedSearch || undefined,
          inStockOnly: inStockOnly ? 'true' : undefined,
          sort,
          limit: 200,
        },
      });
      return res.data.data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['product-stats'],
    queryFn: async () => {
      const r = await api.get<{ data: Stats }>('/products/stats');
      return r.data.data;
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/products/${id}/archive`),
    onSuccess: () => toast.success('Archived'),
  });

  const unarchiveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/products/${id}/unarchive`),
    onSuccess: () => toast.success('Restored'),
  });

  const bulkArchiveMutation = useMutation({
    mutationFn: (ids: string[]) => api.post('/products/bulk/archive', { ids }),
    onSuccess: () => { setSelected(new Set()); toast.success('Archived'); },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.post('/products/bulk/delete', { ids }),
    onSuccess: () => { setSelected(new Set()); toast.success('Deleted'); },
  });

  const items = data?.items ?? [];
  const allChecked = items.length > 0 && items.every((p) => selected.has(p.id));

  const toggleSelectAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(items.map((p) => p.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const clearFilters = () => {
    setFilterCategory(''); setFilterStatus('');
    setSearch(''); setInStockOnly(false);
  };

  const allCategories = stats ? Object.keys(stats.byCategory).filter((c) => c !== 'uncategorized') : [];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-3">
          <Package size={14} className="text-violet-500" />
          <span className="text-xs font-semibold text-gray-900">Products</span>
          {data && <span className="text-[10px] text-gray-400">{data.total} total</span>}
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium">
          <Plus size={11} /> New Product
        </button>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="px-4 py-2 border-b border-gray-100 bg-white shrink-0 grid grid-cols-5 gap-3">
          <StatTile icon={<Package size={12} />} label="Active" value={String(stats.active)} accent="text-violet-600" />
          <StatTile icon={<AlertCircle size={12} />} label="Low stock" value={String(stats.lowStock)} accent="text-orange-600" />
          <StatTile icon={<AlertCircle size={12} />} label="Out of stock" value={String(stats.outOfStock)} accent="text-red-600" />
          <StatTile icon={<Archive size={12} />} label="Archived" value={String(stats.archived)} accent="text-gray-500" />
          <StatTile icon={<TrendingUp size={12} />} label="Catalog value" value={`₹${(stats.catalogValue / 100).toLocaleString()}`} accent="text-emerald-600" />
        </div>
      )}

      {/* Filter rail */}
      <div className="border-b border-gray-100 bg-white shrink-0 px-3 py-2 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 border border-gray-200 rounded px-2 flex-1 max-w-xs">
          <Search size={11} className="text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, SKU, barcode…" className="text-[11px] py-1 w-full focus:outline-none" />
        </div>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as never)} className="text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white">
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="archived">Archived</option>
        </select>
        {allCategories.length > 0 && (
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white">
            <option value="">All categories</option>
            {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value as never)} className="text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white">
          <option value="recent">Sort: Recent</option>
          <option value="name">Sort: Name</option>
          <option value="price">Sort: Price</option>
          <option value="stock">Sort: Stock</option>
          <option value="sold">Sort: Sold</option>
        </select>
        <label className="flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer">
          <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} className="h-3 w-3" />
          In stock only
        </label>
        {(filterCategory || filterStatus || debouncedSearch || inStockOnly) && (
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
            onClick={() => bulkArchiveMutation.mutate([...selected])}
            className="text-[10px] text-gray-700 hover:text-gray-900 flex items-center gap-1"
          >
            <Archive size={10} /> Archive
          </button>
          <button
            onClick={() => { if (confirm(`Delete ${selected.size} products? Items linked to deals will be archived instead.`)) bulkDeleteMutation.mutate([...selected]); }}
            className="text-[10px] text-red-600 hover:text-red-700 flex items-center gap-1"
          >
            <Trash2 size={10} /> Delete
          </button>
          <button onClick={() => setSelected(new Set())} className="text-[10px] text-gray-500 ml-auto">Clear</button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto bg-white">
        {isLoading ? (
          <div className="p-8 text-center text-gray-300 text-xs">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center">
            <Package size={32} className="mx-auto text-gray-200 mb-2" />
            <p className="text-xs text-gray-300 mb-2">No products match those filters.</p>
            <button onClick={clearFilters} className="text-[11px] text-violet-600 hover:text-violet-700">Clear filters</button>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200 sticky top-0">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input type="checkbox" checked={allChecked} onChange={toggleSelectAll} className="h-3 w-3" />
                </th>
                {['Name', 'Price', 'Stock', 'Category', 'SKU', 'Status', ''].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {items.map((p) => {
                const lowStock = p.trackInventory && p.reorderLevel > 0 && p.stock <= p.reorderLevel && p.stock > 0;
                const outOfStock = p.trackInventory && p.stock <= 0;
                return (
                  <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} className="h-3 w-3" />
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/products/${p.id}`} className="text-xs font-medium text-gray-900 hover:text-violet-600">
                        {p.name}
                      </Link>
                      {p.tags.length > 0 && (
                        <div className="flex gap-1 mt-0.5">
                          {p.tags.slice(0, 3).map((t) => (
                            <span key={t} className="text-[9px] bg-gray-100 text-gray-500 px-1 rounded">{t}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700 font-medium">
                      {p.currency} {(p.price / 100).toFixed(2)}
                    </td>
                    <td className="px-3 py-2">
                      {p.trackInventory ? (
                        <span className={cn(
                          'text-[11px]',
                          outOfStock ? 'text-red-600 font-semibold' : lowStock ? 'text-orange-600 font-medium' : 'text-gray-500',
                        )}>
                          {p.stock}
                          {lowStock && <AlertCircle size={9} className="inline ml-1" />}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-gray-500">{p.category ?? '—'}</td>
                    <td className="px-3 py-2 text-[10px] text-gray-400 font-mono">{p.sku ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded font-medium',
                        p.archivedAt ? 'bg-gray-100 text-gray-500' :
                        p.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500',
                      )}>
                        {p.archivedAt ? 'archived' : p.isActive ? 'active' : 'inactive'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => p.archivedAt ? unarchiveMutation.mutate(p.id) : archiveMutation.mutate(p.id)}
                        className="text-gray-400 hover:text-violet-500 p-1"
                        title={p.archivedAt ? 'Unarchive' : 'Archive'}
                      >
                        {p.archivedAt ? <ArchiveRestore size={11} /> : <Archive size={11} />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="h-9 border-t border-gray-200 px-3 flex items-center shrink-0 bg-white">
        <span className="text-[10px] text-gray-400">{data?.total ?? 0} products</span>
      </div>

      {showCreate && <CreateProductModal onClose={() => setShowCreate(false)} />}
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

function CreateProductModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceMajor, setPriceMajor] = useState('');
  const [costMajor, setCostMajor] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [sku, setSku] = useState('');
  const [category, setCategory] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');
  const [trackInventory, setTrackInventory] = useState(false);
  const [stock, setStock] = useState('');
  const [reorderLevel, setReorderLevel] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/products', {
        name,
        description: description || undefined,
        price: Math.round(Number(priceMajor || 0) * 100),
        costPrice: costMajor ? Math.round(Number(costMajor) * 100) : undefined,
        currency,
        sku: sku || undefined,
        category: category || undefined,
        tags: tagsRaw.split(',').map((t) => t.trim()).filter(Boolean),
        trackInventory,
        stock: trackInventory && stock ? Number(stock) : undefined,
        reorderLevel: trackInventory && reorderLevel ? Number(reorderLevel) : undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['product-stats'] });
      toast.success('Product created');
      onClose();
    },
    onError: () => toast.error('Failed to create'),
  });

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[480px] p-4 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-xs font-semibold">New Product</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name (required)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={2} className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs resize-none" />
        <div className="grid grid-cols-3 gap-2">
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="Currency" className="border border-gray-200 rounded px-2 py-1.5 text-xs" />
          <input value={priceMajor} onChange={(e) => setPriceMajor(e.target.value)} type="number" step="0.01" placeholder="Price" className="border border-gray-200 rounded px-2 py-1.5 text-xs" />
          <input value={costMajor} onChange={(e) => setCostMajor(e.target.value)} type="number" step="0.01" placeholder="Cost (opt)" className="border border-gray-200 rounded px-2 py-1.5 text-xs" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU (opt)" className="border border-gray-200 rounded px-2 py-1.5 text-xs" />
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category (opt)" className="border border-gray-200 rounded px-2 py-1.5 text-xs" />
        </div>
        <input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="Tags (comma-separated)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs" />
        <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
          <input type="checkbox" checked={trackInventory} onChange={(e) => setTrackInventory(e.target.checked)} className="h-3 w-3" />
          Track inventory
        </label>
        {trackInventory && (
          <div className="grid grid-cols-2 gap-2">
            <input value={stock} onChange={(e) => setStock(e.target.value)} type="number" placeholder="Initial stock" className="border border-gray-200 rounded px-2 py-1.5 text-xs" />
            <input value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} type="number" placeholder="Reorder level" className="border border-gray-200 rounded px-2 py-1.5 text-xs" />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-gray-500 text-[11px] px-2 py-1">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!name || !priceMajor || mutation.isPending}
            className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30"
          >
            {mutation.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
