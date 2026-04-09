'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { Plus, Package } from 'lucide-react';
import { toast } from 'sonner';

interface Product {
  id: string;
  name: string;
  price: number;
  currency: string;
  sku: string;
  status: string;
  createdAt: string;
}

export default function ProductsPage() {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [sku, setSku] = useState('');
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () => api.post('/products', { name, price: Number(price) * 100, sku }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('Product created');
      setShowForm(false); setName(''); setPrice(''); setSku('');
    },
    onError: () => toast.error('Failed to create product'),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const res = await api.get<{ data: { items: Product[]; total: number } }>('/products');
      return res.data.data;
    },
  });

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <span className="text-xs font-semibold text-gray-900">Products</span>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium">
          <Plus size={11} /> Add
        </button>
      </div>

      {showForm && (
        <div className="border-b border-gray-200 bg-white p-3 space-y-2 shrink-0">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name (required)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price" type="number" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <div className="flex gap-2">
            <button onClick={() => createMutation.mutate()} disabled={!name} className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30">Create</button>
            <button onClick={() => setShowForm(false)} className="text-gray-400 text-[11px] px-2 py-1">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-8 text-center text-gray-300 text-xs">Loading...</div>
        ) : !data?.items?.length ? (
          <div className="p-8 text-center text-gray-300">
            <Package size={24} className="mx-auto mb-2 text-gray-200" />
            <p className="text-xs">No products yet</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200 sticky top-0">
              <tr>
                {['Name', 'Price', 'SKU', 'Status', 'Added'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {data.items.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50/50 transition-colors cursor-pointer">
                  <td className="px-3 py-2 text-xs font-medium text-gray-900">{p.name}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{(p.price / 100).toFixed(2)} {p.currency}</td>
                  <td className="px-3 py-2 text-[11px] text-gray-400 font-mono">{p.sku}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-gray-300">{new Date(p.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data && <div className="h-9 border-t border-gray-200 px-3 flex items-center shrink-0 bg-white">
        <span className="text-[10px] text-gray-400">{data.total} products</span>
      </div>}
    </div>
  );
}
