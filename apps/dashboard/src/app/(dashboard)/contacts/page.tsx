'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import api from '@/lib/api-client';
import { Search, Plus, Phone, Users } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Contact {
  id: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber: string;
  email?: string;
  tags: string[];
  lifecycleStage: string;
  score: number;
  createdAt: string;
}

const LIFECYCLE_COLORS: Record<string, string> = {
  SUBSCRIBER: 'bg-gray-100 text-gray-500',
  LEAD: 'bg-gray-50 text-gray-800',
  MQL: 'bg-gray-50 text-gray-800',
  SQL: 'bg-gray-50 text-gray-800',
  OPPORTUNITY: 'bg-amber-50 text-amber-500',
  CUSTOMER: 'bg-emerald-50 text-emerald-500',
  EVANGELIST: 'bg-pink-50 text-pink-500',
};

const LIFECYCLE_STAGES = ['', 'SUBSCRIBER', 'LEAD', 'MQL', 'SQL', 'OPPORTUNITY', 'CUSTOMER', 'EVANGELIST'];

export default function ContactsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [filterTag, setFilterTag] = useState('');
  const [filterLifecycle, setFilterLifecycle] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['contacts', search, page, filterTag, filterLifecycle],
    queryFn: async () => {
      const res = await api.get<{ data: { items: Contact[]; total: number; totalPages: number } }>('/contacts', {
        params: {
          search: search || undefined,
          tag: filterTag || undefined,
          lifecycle: filterLifecycle || undefined,
          page,
        },
      });
      return res.data.data;
    },
  });

  const { data: tags } = useQuery({
    queryKey: ['tags'],
    queryFn: async () => {
      const res = await api.get<{ data: Array<{ id: string; name: string; color: string }> }>('/tags');
      return res.data.data;
    },
  });

  // Reject anything with letters in the phone field — the backend normaliser
  // used to silently strip non-digits (so "ABC123" became "+91123"), which
  // let garbage contacts into the system. Keep this regex loose: allow +,
  // spaces, dashes, parens and digits; require at least 7 digits total.
  const phoneValid = (() => {
    const raw = phoneNumber.trim();
    if (!raw) return false;
    if (/[A-Za-z]/.test(raw)) return false;
    const digits = raw.replace(/\D/g, '');
    return digits.length >= 7;
  })();

  const createMutation = useMutation({
    mutationFn: () => api.post('/contacts', {
      phoneNumber, displayName: displayName || undefined,
      firstName: firstName || undefined, lastName: lastName || undefined,
      email: email || undefined, companyName: companyName || undefined,
      jobTitle: jobTitle || undefined,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contacts'] });
      toast.success('Contact created');
      setShowForm(false);
      setPhoneNumber(''); setDisplayName(''); setFirstName(''); setLastName('');
      setEmail(''); setCompanyName(''); setJobTitle('');
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to create contact';
      toast.error(msg);
    },
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
              className="w-40 pl-7 pr-2 py-1 border border-gray-200 rounded text-[11px] focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder:text-gray-300"
            />
          </div>
          <select
            value={filterLifecycle}
            onChange={(e) => { setFilterLifecycle(e.target.value); setPage(1); }}
            className="border border-gray-200 rounded px-1.5 py-1 text-[10px] text-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
          >
            <option value="">All stages</option>
            {LIFECYCLE_STAGES.filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {tags && tags.length > 0 && (
            <select
              value={filterTag}
              onChange={(e) => { setFilterTag(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded px-1.5 py-1 text-[10px] text-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
            >
              <option value="">All tags</option>
              {tags.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          )}
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium">
            <Plus size={11} />
            Add
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="border-b border-gray-200 bg-white p-3 shrink-0">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-2">
            <div className="flex flex-col">
              <input
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="Phone (required)"
                type="tel"
                inputMode="tel"
                pattern="^[+]?[0-9\s\-()]+$"
                aria-invalid={phoneNumber.length > 0 && !phoneValid}
                className={`border rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 ${phoneNumber.length > 0 && !phoneValid ? 'border-red-300 focus:ring-red-400' : 'border-gray-200 focus:ring-gray-400'}`}
              />
              {phoneNumber.length > 0 && !phoneValid && (
                <span className="text-[10px] text-red-500 mt-0.5">Digits only — letters are not allowed.</span>
              )}
            </div>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" className="border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400" />
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" className="border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400" />
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" className="border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" className="border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400" />
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company" className="border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400" />
            <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Job title" className="border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => createMutation.mutate()} disabled={!phoneValid || createMutation.isPending} className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30">
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </button>
            <button onClick={() => setShowForm(false)} className="text-gray-400 text-[11px] px-2 py-1">Cancel</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-8 text-center text-gray-300 text-xs">Loading...</div>
        ) : !data?.items.length ? (
          <div className="p-12 text-center">
            <Users size={24} className="mx-auto text-gray-200 mb-2" />
            <p className="text-xs text-gray-400">No contacts found</p>
            <p className="text-[10px] text-gray-300 mt-1">Add your first contact or send a WhatsApp message to auto-create one</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200 sticky top-0">
              <tr>
                {['Name', 'Phone', 'Email', 'Stage', 'Score', 'Tags', 'Added'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {data.items.map((contact) => (
                <tr
                  key={contact.id}
                  onClick={() => router.push(`/contacts/${contact.id}`)}
                  className="hover:bg-gray-50/30 transition-colors cursor-pointer"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-gray-100 text-gray-900 flex items-center justify-center text-[10px] font-bold shrink-0">
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
                    <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium', LIFECYCLE_COLORS[contact.lifecycleStage] || 'bg-gray-100 text-gray-400')}>
                      {contact.lifecycleStage}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-10 bg-gray-100 rounded-full h-1">
                        <div className="bg-gray-800 h-1 rounded-full" style={{ width: `${Math.min(contact.score, 100)}%` }} />
                      </div>
                      <span className="text-[9px] text-gray-400">{contact.score}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-0.5">
                      {(contact.tags ?? []).slice(0, 3).map((tag) => (
                        <span key={tag} className="text-[9px] bg-gray-50 text-gray-800 px-1 py-0.5 rounded">
                          {tag}
                        </span>
                      ))}
                      {(contact.tags ?? []).length > 3 && (
                        <span className="text-[9px] text-gray-300">+{contact.tags.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[10px] text-gray-300">
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
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="text-[11px] px-2 py-0.5 border border-gray-200 rounded text-gray-500 disabled:opacity-30 hover:bg-gray-50">Prev</button>
            <span className="text-[10px] text-gray-400 px-1">{page}/{data.totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages} className="text-[11px] px-2 py-0.5 border border-gray-200 rounded text-gray-500 disabled:opacity-30 hover:bg-gray-50">Next</button>
          </div>
        </div>
      )}
      {data && data.totalPages <= 1 && (
        <div className="h-9 border-t border-gray-200 px-3 flex items-center shrink-0 bg-white">
          <span className="text-[10px] text-gray-400">{data?.total ?? 0} contacts</span>
        </div>
      )}
    </div>
  );
}
