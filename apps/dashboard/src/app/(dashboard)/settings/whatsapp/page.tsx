'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { useWhatsAppQr } from '@/hooks/use-whatsapp-qr';
import { toast } from 'sonner';
import { Smartphone, Plus, Trash2, RefreshCw, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WaAccount {
  id: string;
  phoneNumber: string;
  displayName?: string;
  status: string;
  warmupStage: number;
  messagesSentToday: number;
  dailyMessageLimit: number;
  lastConnectedAt?: string;
}

const STATUS_COLORS: Record<string, string> = {
  CONNECTED: 'text-green-600',
  DISCONNECTED: 'text-gray-400',
  QR_PENDING: 'text-yellow-500',
  CONNECTING: 'text-blue-500',
  BANNED: 'text-red-500',
  ERROR: 'text-red-500',
};

function AccountCard({ account, onDelete }: { account: WaAccount; onDelete: (id: string) => void }) {
  const qrState = useWhatsAppQr(account.status === 'QR_PENDING' ? account.id : null);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
            <Smartphone size={18} className="text-green-600" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">{account.displayName ?? account.phoneNumber}</p>
            <p className="text-sm text-gray-500">{account.phoneNumber}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('text-xs font-medium flex items-center gap-1', STATUS_COLORS[account.status] ?? 'text-gray-500')}>
            {account.status === 'CONNECTED' && <CheckCircle size={12} />}
            {account.status === 'ERROR' && <XCircle size={12} />}
            {account.status === 'CONNECTING' && <Loader2 size={12} className="animate-spin" />}
            {account.status}
          </span>
        </div>
      </div>

      {account.status === 'QR_PENDING' && qrState.qrCode && (
        <div className="mb-4 p-4 bg-gray-50 rounded-lg text-center">
          <p className="text-sm text-gray-600 mb-2 font-medium">Scan with WhatsApp</p>
          <div className="w-40 h-40 bg-white border border-gray-200 rounded-lg mx-auto flex items-center justify-center text-xs text-gray-400">
            QR Code<br />(install qrcode.react)
          </div>
          <p className="text-xs text-gray-400 mt-2">Waiting for scan…</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 text-center mb-4">
        <div className="bg-gray-50 rounded-lg p-2">
          <p className="text-lg font-bold text-gray-900">{account.warmupStage}/5</p>
          <p className="text-xs text-gray-500">Warmup stage</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-2">
          <p className="text-lg font-bold text-gray-900">{account.messagesSentToday}</p>
          <p className="text-xs text-gray-500">Sent today</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-2">
          <p className="text-lg font-bold text-gray-900">{account.dailyMessageLimit}</p>
          <p className="text-xs text-gray-500">Daily limit</p>
        </div>
      </div>

      <div className="flex gap-2">
        <button className="flex items-center gap-1.5 text-xs border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50">
          <RefreshCw size={12} />
          Reconnect
        </button>
        <button
          onClick={() => onDelete(account.id)}
          className="flex items-center gap-1.5 text-xs border border-red-200 text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 ml-auto"
        >
          <Trash2 size={12} />
          Remove
        </button>
      </div>
    </div>
  );
}

export default function WhatsAppSettingsPage() {
  const qc = useQueryClient();

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['wa-accounts'],
    queryFn: async () => {
      const res = await api.get<{ data: WaAccount[] }>('/settings/whatsapp/accounts');
      return res.data.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/settings/whatsapp/accounts'),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['wa-accounts'] }); toast.success('New account created — scan QR to connect'); },
    onError: () => toast.error('Failed to create account'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/whatsapp/accounts/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['wa-accounts'] }); toast.success('Account removed'); },
    onError: () => toast.error('Failed to remove account'),
  });

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
            <Smartphone size={20} className="text-green-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">WhatsApp Accounts</h1>
            <p className="text-sm text-gray-500">Connect and manage WhatsApp numbers</p>
          </div>
        </div>
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          <Plus size={14} />
          Add Account
        </button>
      </div>

      {isLoading ? (
        <div className="text-center text-gray-400 py-8">Loading…</div>
      ) : accounts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Smartphone size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No WhatsApp accounts connected</p>
          <p className="text-sm text-gray-400 mt-1">Click &ldquo;Add Account&rdquo; to connect your first WhatsApp number</p>
        </div>
      ) : (
        <div className="space-y-4">
          {accounts.map((acc) => (
            <AccountCard key={acc.id} account={acc} onDelete={(id) => deleteMutation.mutate(id)} />
          ))}
        </div>
      )}
    </div>
  );
}
