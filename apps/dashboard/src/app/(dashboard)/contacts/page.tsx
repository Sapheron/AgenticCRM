'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { Search, Plus, Phone } from 'lucide-react';
import { toast } from 'sonner';

interface Contact {
  id: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber: string;
  email?: string;
  tags: string[];
  createdAt: string;
}

export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['contacts', search, page],
    queryFn: async () => {
      const res = await api.get<{ data: { items: Contact[]; total: number; totalPages: number } }>('/contacts', {
        params: { search: search || undefined, page },
      });
      return res.data.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/contacts', { phoneNumber, displayName, email }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contacts'] });
      toast.success('Contact created');
      setShowForm(false); setPhoneNumber(''); setDisplayName(''); setEmail('');
    },
    onError: () => toast.error('Failed to create contact'),
  });

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <span className="text-xs font-semibold text-gray-900">Contacts</span>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-300" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search..."
              className="w-48 pl-7 pr-2 py-1 border border-gray-200 rounded text-[11px] focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400 placeholder:text-gray-300"
            />
          </div>
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium">
            <Plus size={11} />
            Add
          </button>
        </div>
      </div>

      {showForm && (
        <div className="border-b border-gray-200 bg-white p-3 space-y-2 shrink-0">
          <input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="Phone number (required)" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
          <div className="flex gap-2">
            <button onClick={() => createMutation.mutate()} disabled={!phoneNumber} className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30">Create</button>
            <button onClick={() => setShowForm(false)} className="text-gray-400 text-[11px] px-2 py-1">Cancel</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-8 text-center text-gray-300 text-xs">Loading...</div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200 sticky top-0">
              <tr>
                {['Name', 'Phone', 'Email', 'Tags', 'Added'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {data?.items.map((contact) => (
                <tr key={contact.id} className="hover:bg-gray-50/50 transition-colors cursor-pointer">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center text-[10px] font-medium text-gray-500 shrink-0">
                        {((contact.displayName || contact.firstName || '?')[0] ?? '?').toUpperCase()}
                      </div>
                      <span className="text-xs font-medium text-gray-900 truncate">
                        {(contact.displayName ?? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim()) || 'Unknown'}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <Phone size={10} className="text-gray-300" />
                      {contact.phoneNumber}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-400">{contact.email ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-0.5">
                      {(contact.tags ?? []).map((tag) => (
                        <span key={tag} className="text-[10px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-gray-300">
                    {new Date(contact.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      {data && data.totalPages > 1 && (
        <div className="h-9 border-t border-gray-200 px-3 flex items-center justify-between shrink-0 bg-white">
          <span className="text-[10px] text-gray-400">{data.total} contacts</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="text-[11px] px-2 py-0.5 border border-gray-200 rounded text-gray-500 disabled:opacity-30 hover:bg-gray-50"
            >
              Prev
            </button>
            <span className="text-[10px] text-gray-400 px-1">{page}/{data.totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={page === data.totalPages}
              className="text-[11px] px-2 py-0.5 border border-gray-200 rounded text-gray-500 disabled:opacity-30 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
