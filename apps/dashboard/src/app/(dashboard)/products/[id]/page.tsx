'use client';

/**
 * Product detail page — three-column Linear-style layout matching the
 * leads/deals/tasks pattern, plus product-specific extras: variants table,
 * stock adjust form, image gallery, activity timeline.
 */

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { toast } from 'sonner';
import { cn, formatRelativeTime } from '@/lib/utils';
import {
  ArrowLeft, Save, Trash2, Plus, X, Activity as ActivityIcon, Package,
  Layers, Image as ImageIcon, AlertCircle, Archive, ArchiveRestore,
} from 'lucide-react';

interface ProductVariant {
  id: string;
  name: string;
  sku?: string;
  price?: number;
  stock?: number;
}

interface ProductDetail {
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
  variants: ProductVariant[];
  isActive: boolean;
  archivedAt?: string;
  totalSold: number;
  createdAt: string;
  updatedAt: string;
  activities: Array<{
    id: string;
    type: string;
    actorType: string;
    title: string;
    body?: string;
    createdAt: string;
  }>;
}

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'variants' | 'images' | 'activity'>('variants');
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [stockDelta, setStockDelta] = useState('');
  const [stockReason, setStockReason] = useState('');
  const [showVariantForm, setShowVariantForm] = useState(false);
  const [newImageUrl, setNewImageUrl] = useState('');

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: async () => {
      const r = await api.get<{ data: ProductDetail }>(`/products/${id}`);
      return r.data.data;
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['product', id] });
    void qc.invalidateQueries({ queryKey: ['products'] });
    void qc.invalidateQueries({ queryKey: ['product-stats'] });
  };

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/products/${id}`, data),
    onSuccess: () => { invalidate(); setEditMode(false); toast.success('Saved'); },
    onError: () => toast.error('Save failed'),
  });

  const adjustStockMutation = useMutation({
    mutationFn: ({ delta, reason }: { delta: number; reason?: string }) =>
      api.post(`/products/${id}/stock/adjust`, { delta, reason }),
    onSuccess: () => { invalidate(); setStockDelta(''); setStockReason(''); toast.success('Stock updated'); },
  });

  const archiveMutation = useMutation({
    mutationFn: () => api.post(`/products/${id}/archive`),
    onSuccess: () => { invalidate(); toast.success('Archived'); },
  });

  const unarchiveMutation = useMutation({
    mutationFn: () => api.post(`/products/${id}/unarchive`),
    onSuccess: () => { invalidate(); toast.success('Restored'); },
  });

  const addVariantMutation = useMutation({
    mutationFn: (variant: Omit<ProductVariant, 'id'>) =>
      api.post(`/products/${id}/variants`, variant),
    onSuccess: () => { invalidate(); setShowVariantForm(false); toast.success('Variant added'); },
  });

  const removeVariantMutation = useMutation({
    mutationFn: (variantId: string) => api.delete(`/products/${id}/variants/${variantId}`),
    onSuccess: () => { invalidate(); toast.success('Variant removed'); },
  });

  const updateImagesMutation = useMutation({
    mutationFn: (images: string[]) => api.patch(`/products/${id}`, { images }),
    onSuccess: () => { invalidate(); setNewImageUrl(''); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/products/${id}`),
    onSuccess: () => { toast.success('Removed'); router.push('/products'); },
  });

  const startEdit = () => {
    if (!product) return;
    setForm({
      name: product.name,
      description: product.description ?? '',
      priceMajor: (product.price / 100).toString(),
      costMajor: product.costPrice ? (product.costPrice / 100).toString() : '',
      currency: product.currency,
      sku: product.sku ?? '',
      barcode: product.barcode ?? '',
      category: product.category ?? '',
      tags: product.tags.join(', '),
      reorderLevel: product.reorderLevel.toString(),
      trackInventory: product.trackInventory ? 'true' : 'false',
    });
    setEditMode(true);
  };

  const saveEdit = () => {
    updateMutation.mutate({
      name: form.name,
      description: form.description || null,
      price: Math.round(Number(form.priceMajor || 0) * 100),
      costPrice: form.costMajor ? Math.round(Number(form.costMajor) * 100) : null,
      currency: form.currency,
      sku: form.sku || null,
      barcode: form.barcode || null,
      category: form.category || null,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      reorderLevel: Number(form.reorderLevel || 0),
      trackInventory: form.trackInventory === 'true',
    });
  };

  if (isLoading || !product) {
    return <div className="p-12 text-center text-xs text-gray-300">Loading…</div>;
  }

  const lowStock = product.trackInventory && product.reorderLevel > 0 && product.stock <= product.reorderLevel && product.stock > 0;
  const outOfStock = product.trackInventory && product.stock <= 0;
  const margin = product.costPrice && product.price > 0
    ? Math.round(((product.price - product.costPrice) / product.price) * 100)
    : null;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => router.push('/products')} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft size={14} />
          </button>
          <Package size={14} className="text-violet-500 shrink-0" />
          <span className="text-xs font-semibold text-gray-900 truncate max-w-md">{product.name}</span>
          <span className={cn(
            'text-[10px] px-1.5 py-0.5 rounded font-medium',
            product.archivedAt ? 'bg-gray-100 text-gray-500' :
            product.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500',
          )}>
            {product.archivedAt ? 'archived' : product.isActive ? 'active' : 'inactive'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!editMode ? (
            <button onClick={startEdit} className="text-[11px] text-violet-600 hover:text-violet-700">Edit</button>
          ) : (
            <>
              <button onClick={() => setEditMode(false)} className="text-[11px] text-gray-500">Cancel</button>
              <button onClick={saveEdit} disabled={updateMutation.isPending} className="text-[11px] bg-gray-900 text-white px-2.5 py-0.5 rounded flex items-center gap-1 disabled:opacity-30">
                <Save size={10} /> Save
              </button>
            </>
          )}
          <button
            onClick={() => product.archivedAt ? unarchiveMutation.mutate() : archiveMutation.mutate()}
            className="text-gray-400 hover:text-violet-500 p-1"
            title={product.archivedAt ? 'Unarchive' : 'Archive'}
          >
            {product.archivedAt ? <ArchiveRestore size={12} /> : <Archive size={12} />}
          </button>
          <button
            onClick={() => { if (confirm('Delete this product? It will be archived if linked to deals.')) deleteMutation.mutate(); }}
            className="text-gray-400 hover:text-red-500 p-1"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Left: info */}
        <aside className="w-72 border-r border-gray-200 bg-white overflow-auto p-3 space-y-3 shrink-0">
          {!editMode ? (
            <>
              {product.description && (
                <Field label="Description" value={
                  <p className="text-[11px] text-gray-600 whitespace-pre-wrap">{product.description}</p>
                } />
              )}
              <Field label="Price" value={
                <span className="text-sm font-semibold text-gray-900">
                  {product.currency} {(product.price / 100).toFixed(2)}
                </span>
              } />
              {product.costPrice && (
                <Field label="Cost" value={
                  <div>
                    <div className="text-[11px] text-gray-700">{product.currency} {(product.costPrice / 100).toFixed(2)}</div>
                    {margin !== null && <div className="text-[10px] text-emerald-600">Margin: {margin}%</div>}
                  </div>
                } />
              )}
              {product.sku && <Field label="SKU" value={<code className="text-[10px] font-mono">{product.sku}</code>} />}
              {product.barcode && <Field label="Barcode" value={<code className="text-[10px] font-mono">{product.barcode}</code>} />}
              {product.category && <Field label="Category" value={product.category} />}
              <Field label="Tags" value={
                <div className="flex flex-wrap gap-1">
                  {product.tags.length === 0 ? '—' : product.tags.map((t) => (
                    <span key={t} className="text-[9px] bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded">{t}</span>
                  ))}
                </div>
              } />
              <Field label="Inventory" value={
                product.trackInventory ? (
                  <div>
                    <div className={cn(
                      'text-[12px] font-semibold',
                      outOfStock ? 'text-red-600' : lowStock ? 'text-orange-600' : 'text-gray-900',
                    )}>
                      {product.stock} in stock
                      {lowStock && <AlertCircle size={11} className="inline ml-1" />}
                    </div>
                    {product.reorderLevel > 0 && (
                      <div className="text-[10px] text-gray-400">Reorder at: {product.reorderLevel}</div>
                    )}
                    <div className="flex gap-1 mt-2">
                      <input
                        type="number"
                        value={stockDelta}
                        onChange={(e) => setStockDelta(e.target.value)}
                        placeholder="±"
                        className="w-14 border border-gray-200 rounded px-1.5 py-0.5 text-[11px]"
                      />
                      <input
                        value={stockReason}
                        onChange={(e) => setStockReason(e.target.value)}
                        placeholder="reason"
                        className="flex-1 border border-gray-200 rounded px-1.5 py-0.5 text-[10px]"
                      />
                      <button
                        onClick={() => {
                          const delta = Number(stockDelta);
                          if (delta !== 0) adjustStockMutation.mutate({ delta, reason: stockReason || undefined });
                        }}
                        className="text-[10px] bg-gray-900 text-white px-2 rounded"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                ) : (
                  <span className="text-[11px] text-gray-400">Not tracked</span>
                )
              } />
              {product.totalSold > 0 && (
                <Field label="Total sold" value={String(product.totalSold)} />
              )}
              <Field label="Created" value={formatRelativeTime(product.createdAt)} />
            </>
          ) : (
            <>
              <EditField label="Name">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
              </EditField>
              <EditField label="Description">
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px] resize-none" />
              </EditField>
              <EditField label="Price">
                <div className="flex gap-1">
                  <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="w-12 border border-gray-200 rounded px-2 py-1 text-[11px]" />
                  <input value={form.priceMajor} onChange={(e) => setForm({ ...form, priceMajor: e.target.value })} type="number" step="0.01" className="flex-1 border border-gray-200 rounded px-2 py-1 text-[11px]" />
                </div>
              </EditField>
              <EditField label="Cost">
                <input value={form.costMajor} onChange={(e) => setForm({ ...form, costMajor: e.target.value })} type="number" step="0.01" className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
              </EditField>
              <EditField label="SKU">
                <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
              </EditField>
              <EditField label="Barcode">
                <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
              </EditField>
              <EditField label="Category">
                <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
              </EditField>
              <EditField label="Tags (comma)">
                <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
              </EditField>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
                <input
                  type="checkbox"
                  checked={form.trackInventory === 'true'}
                  onChange={(e) => setForm({ ...form, trackInventory: e.target.checked ? 'true' : 'false' })}
                  className="h-3 w-3"
                />
                Track inventory
              </label>
              {form.trackInventory === 'true' && (
                <EditField label="Reorder level">
                  <input value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} type="number" className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
                </EditField>
              )}
            </>
          )}
        </aside>

        {/* Center: tabs */}
        <main className="flex-1 overflow-auto bg-white">
          <div className="border-b border-gray-100 px-4 flex items-center gap-3">
            {([
              ['variants', 'Variants', product.variants.length, Layers],
              ['images', 'Images', product.images.length, ImageIcon],
              ['activity', 'Activity', null, ActivityIcon],
            ] as const).map(([key, label, count, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  'text-[11px] py-2 border-b-2 transition flex items-center gap-1.5',
                  tab === key ? 'border-violet-500 text-violet-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700',
                )}
              >
                <Icon size={11} /> {label}
                {count !== null && count > 0 && <span className="text-[10px] text-gray-400">({count})</span>}
              </button>
            ))}
          </div>

          {tab === 'variants' && (
            <div className="p-4 space-y-3">
              <div className="flex justify-between items-center">
                <p className="text-[11px] text-gray-500">{product.variants.length} variant{product.variants.length === 1 ? '' : 's'}</p>
                <button
                  onClick={() => setShowVariantForm(true)}
                  className="text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded flex items-center gap-1"
                >
                  <Plus size={9} /> Add variant
                </button>
              </div>
              {showVariantForm && (
                <VariantForm
                  currency={product.currency}
                  onCancel={() => setShowVariantForm(false)}
                  onSubmit={(v) => addVariantMutation.mutate(v)}
                  pending={addVariantMutation.isPending}
                />
              )}
              {product.variants.length === 0 ? (
                <p className="text-[11px] text-gray-300 text-center py-6">No variants yet.</p>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50/80 border-b border-gray-200">
                    <tr>
                      {['Name', 'SKU', 'Price', 'Stock', ''].map((h) => (
                        <th key={h} className="text-left px-2 py-1 text-[9px] font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {product.variants.map((v) => (
                      <tr key={v.id} className="hover:bg-gray-50/50">
                        <td className="px-2 py-1.5 text-[11px] font-medium text-gray-900">{v.name}</td>
                        <td className="px-2 py-1.5 text-[10px] font-mono text-gray-500">{v.sku ?? '—'}</td>
                        <td className="px-2 py-1.5 text-[11px] text-gray-700">
                          {v.price !== undefined ? `${product.currency} ${(v.price / 100).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-[11px] text-gray-700">{v.stock ?? '—'}</td>
                        <td className="px-2 py-1.5">
                          <button
                            onClick={() => removeVariantMutation.mutate(v.id)}
                            className="text-gray-400 hover:text-red-500"
                          >
                            <X size={11} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'images' && (
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <input
                  value={newImageUrl}
                  onChange={(e) => setNewImageUrl(e.target.value)}
                  placeholder="Paste image URL…"
                  className="flex-1 border border-gray-200 rounded px-2.5 py-1.5 text-xs"
                />
                <button
                  onClick={() => {
                    if (newImageUrl.trim()) updateImagesMutation.mutate([...product.images, newImageUrl.trim()]);
                  }}
                  disabled={!newImageUrl.trim()}
                  className="bg-gray-900 text-white px-3 rounded text-[11px] disabled:opacity-30 flex items-center gap-1"
                >
                  <Plus size={11} /> Add
                </button>
              </div>
              {product.images.length === 0 ? (
                <p className="text-[11px] text-gray-300 text-center py-6">No images yet.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {product.images.map((url, i) => (
                    <div key={i} className="relative group border border-gray-200 rounded overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="w-full h-32 object-cover" />
                      <button
                        onClick={() => updateImagesMutation.mutate(product.images.filter((_, idx) => idx !== i))}
                        className="absolute top-1 right-1 bg-white/90 text-red-500 p-1 rounded opacity-0 group-hover:opacity-100 transition"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'activity' && (
            <div className="p-4 space-y-2">
              {product.activities.length === 0 ? (
                <p className="text-[11px] text-gray-300 text-center py-6">No activity yet.</p>
              ) : (
                product.activities.map((a) => (
                  <div key={a.id} className="flex gap-2">
                    <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-violet-300 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                        <span className="font-mono uppercase tracking-wider">{a.type}</span>
                        <span>·</span>
                        <span>{a.actorType}</span>
                        <span>·</span>
                        <span>{formatRelativeTime(a.createdAt)}</span>
                      </div>
                      <div className="text-[11px] text-gray-800 mt-0.5">{a.title}</div>
                      {a.body && <div className="text-[10px] text-gray-500 mt-0.5 whitespace-pre-wrap">{a.body}</div>}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-widest text-gray-400">{label}</p>
      <div className="text-[11px] text-gray-700 mt-0.5">{value}</div>
    </div>
  );
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-0.5">{label}</p>
      {children}
    </div>
  );
}

function VariantForm({
  currency,
  onCancel,
  onSubmit,
  pending,
}: {
  currency: string;
  onCancel: () => void;
  onSubmit: (v: { name: string; sku?: string; price?: number; stock?: number }) => void;
  pending: boolean;
}) {
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [priceMajor, setPriceMajor] = useState('');
  const [stock, setStock] = useState('');

  return (
    <div className="border border-violet-200 bg-violet-50/30 rounded p-2 space-y-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder='Variant name (e.g. "Red - Large")' className="w-full border border-gray-200 rounded px-2 py-1 text-[11px]" />
      <div className="grid grid-cols-3 gap-1.5">
        <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU" className="border border-gray-200 rounded px-2 py-1 text-[11px]" />
        <input value={priceMajor} onChange={(e) => setPriceMajor(e.target.value)} type="number" step="0.01" placeholder={`Price (${currency})`} className="border border-gray-200 rounded px-2 py-1 text-[11px]" />
        <input value={stock} onChange={(e) => setStock(e.target.value)} type="number" placeholder="Stock" className="border border-gray-200 rounded px-2 py-1 text-[11px]" />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-[10px] text-gray-500 px-2">Cancel</button>
        <button
          onClick={() => onSubmit({
            name,
            sku: sku || undefined,
            price: priceMajor ? Math.round(Number(priceMajor) * 100) : undefined,
            stock: stock ? Number(stock) : undefined,
          })}
          disabled={!name || pending}
          className="text-[10px] bg-gray-900 text-white px-2 py-1 rounded disabled:opacity-30"
        >
          {pending ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  );
}
