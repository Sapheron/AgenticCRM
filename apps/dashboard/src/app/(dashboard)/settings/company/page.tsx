'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { toast } from 'sonner';
import { Building2 } from 'lucide-react';

export default function CompanySettingsPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');

  const { data: company } = useQuery({
    queryKey: ['company'],
    queryFn: async () => {
      const res = await api.get<{ data: { name: string; email?: string; phone?: string; website?: string; timezone?: string } }>('/company');
      return res.data.data;
    },
  });

  useEffect(() => {
    if (company) {
      setName(company.name ?? '');
      setEmail(company.email ?? '');
      setPhone(company.phone ?? '');
      setWebsite(company.website ?? '');
      setTimezone(company.timezone ?? 'Asia/Kolkata');
    }
  }, [company]);

  const saveMutation = useMutation({
    mutationFn: () => api.patch('/company', { name, email, phone, website, timezone }),
    onSuccess: () => toast.success('Company settings saved'),
    onError: () => toast.error('Failed to save settings'),
  });

  const timezones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['Asia/Kolkata', 'UTC', 'America/New_York', 'Europe/London'];

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center">
          <Building2 size={20} className="text-purple-600" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Company Settings</h1>
          <p className="text-sm text-gray-500">Update your company profile</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <label className="text-sm font-medium text-gray-700">Company Name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700">Business Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700">Phone</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700">Website</label>
          <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700">Timezone</label>
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
            {timezones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </div>
        <div className="pt-2">
          <button onClick={() => saveMutation.mutate()} disabled={!name || saveMutation.isPending} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
