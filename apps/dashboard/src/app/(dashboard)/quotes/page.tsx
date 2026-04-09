'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { Plus, FileText } from 'lucide-react';
import { toast } from 'sonner';

interface Quote {
  id: string;
  number: string;
  total: number;
  currency: string;
  status: string;
  validUntil: string;
  createdAt: string;
}

const statusColor: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-400',
  sent: 'bg-blue-50 text-blue-600',
  accepted: 'bg-emerald-50 text-emerald-600',
  declined: 'bg-red-50 text-red-600',
  expired: 'bg-amber-50 text-amber-600',
};

export default function QuotesPage() {
  const [showForm, setShowForm] = useState(false);
  const [notes, setNotes] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemQty, setItemQty] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () => api.post('/quotes', { notes, lineItems: [{ name: itemName, quantity: Number(itemQty), unitPrice: Number(itemPrice) }] }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['quotes'] });
      toast.success('Quote created');
      setShowForm(false); setNotes(''); setItemName(''); setItemQty(''); setItemPrice('');
    },
    onError: () => toast.error('Failed to create quote'),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['quotes'],
    queryFn: async () => {
      const res = await api.get<{ data: { items: Quote[]; total: number } }>('/quotes');
      return res.data.data;
    },
  });

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <span className="text-xs font-semibold text-gray-900">Quotes</span>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium">
          <Plus size={11} /> Add
        </button>
      </div>

      {showForm && (
        <div className="border-b border-gray-200 bg-white p-3 space-y-2 shrink-0">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <div className="flex gap-2">
            <input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Item name" className="flex-1 border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
            <input value={itemQty} onChange={(e) => setItemQty(e.target.value)} placeholder="Qty" type="number" className="w-20 border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
            <input value={itemPrice} onChange={(e) => setItemPrice(e.target.value)} placeholder="Unit price" type="number" className="w-28 border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => createMutation.mutate()} disabled={!itemName} className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30">Create</button>
            <button onClick={() => setShowForm(false)} className="text-gray-400 text-[11px] px-2 py-1">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-8 text-center text-gray-300 text-xs">Loading...</div>
        ) : !data?.items?.length ? (
          <div className="p-8 text-center text-gray-300">
            <FileText size={24} className="mx-auto mb-2 text-gray-200" />
            <p className="text-xs">No quotes yet</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200 sticky top-0">
              <tr>
                {['Number', 'Total', 'Status', 'Valid Until', 'Created'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {data.items.map((q) => (
                <tr key={q.id} className="hover:bg-gray-50/50 transition-colors cursor-pointer">
                  <td className="px-3 py-2 text-xs font-medium text-gray-900 font-mono">{q.number}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{(q.total / 100).toFixed(2)} {q.currency}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor[q.status] ?? 'bg-gray-100 text-gray-400'}`}>{q.status}</span></td>
                  <td className="px-3 py-2 text-[11px] text-gray-300">{new Date(q.validUntil).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-[11px] text-gray-300">{new Date(q.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data && <div className="h-9 border-t border-gray-200 px-3 flex items-center shrink-0 bg-white">
        <span className="text-[10px] text-gray-400">{data.total} quotes</span>
      </div>}
    </div>
  );
}
