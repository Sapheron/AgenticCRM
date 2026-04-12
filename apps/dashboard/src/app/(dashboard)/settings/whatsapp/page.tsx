'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import api from '@/lib/api-client';
import { useWhatsAppQr } from '@/hooks/use-whatsapp-qr';
import { useAuthStore } from '@/stores/auth.store';
import { toast } from 'sonner';
import { Smartphone, Plus, Trash2, RefreshCw, CheckCircle, XCircle, Loader2, User } from 'lucide-react';
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
  userId?: string;
  user?: { id: string; firstName: string; lastName: string; email: string };
}

const STATUS_COLORS: Record<string, string> = {
  CONNECTED: 'text-violet-500',
  DISCONNECTED: 'text-gray-400',
  QR_PENDING: 'text-yellow-500',
  CONNECTING: 'text-blue-500',
  BANNED: 'text-red-500',
  ERROR: 'text-red-500',
};

function AccountCard({
  account,
  onDelete,
  onReconnect,
  isReconnecting,
  showOwner,
}: {
  account: WaAccount;
  onDelete: (id: string) => void;
  onReconnect: (id: string) => void;
  isReconnecting: boolean;
  showOwner: boolean;
}) {
  const needsQr = account.status === 'QR_PENDING' || account.status === 'CONNECTING';
  const qrState = useWhatsAppQr(needsQr ? account.id : null);

  // Show connected state from WebSocket even before list refetch
  const isConnected = account.status === 'CONNECTED' || qrState.connected;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center">
            <Smartphone size={18} className="text-violet-500" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">
              {qrState.displayName ?? account.displayName ?? account.phoneNumber}
            </p>
            <p className="text-sm text-gray-500">
              {qrState.phoneNumber ?? account.phoneNumber}
            </p>
            {showOwner && account.user && (
              <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                <User size={10} />
                {account.user.firstName} {account.user.lastName}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-xs font-medium flex items-center gap-1',
            isConnected ? STATUS_COLORS.CONNECTED : (STATUS_COLORS[account.status] ?? 'text-gray-500'),
          )}>
            {isConnected && <CheckCircle size={12} />}
            {account.status === 'ERROR' && !isConnected && <XCircle size={12} />}
            {(account.status === 'CONNECTING' || (account.status === 'QR_PENDING' && !qrState.qrCode)) && !isConnected && (
              <Loader2 size={12} className="animate-spin" />
            )}
            {isConnected ? 'CONNECTED' : account.status}
          </span>
        </div>
      </div>

      {/* QR Code display */}
      {needsQr && !isConnected && (
        <div className="mb-4 p-4 bg-gray-50 rounded-lg text-center">
          {qrState.qrCode ? (
            <>
              <p className="text-sm text-gray-600 mb-3 font-medium">Scan with WhatsApp</p>
              <div className="bg-white p-3 rounded-lg inline-block border border-gray-200">
                <QRCodeSVG value={qrState.qrCode} size={200} level="M" />
              </div>
              <p className="text-xs text-gray-400 mt-3">
                Open WhatsApp &rarr; Settings &rarr; Linked Devices &rarr; Link a Device
              </p>
            </>
          ) : (
            <div className="py-6">
              <Loader2 size={24} className="animate-spin text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-500">Generating QR code…</p>
            </div>
          )}
        </div>
      )}

      {/* Connected success state */}
      {isConnected && account.status === 'QR_PENDING' && (
        <div className="mb-4 p-4 bg-violet-50 rounded-lg text-center">
          <CheckCircle size={24} className="text-violet-500 mx-auto mb-2" />
          <p className="text-sm text-violet-600 font-medium">WhatsApp connected successfully!</p>
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
        <button
          onClick={() => onReconnect(account.id)}
          disabled={isReconnecting}
          className="flex items-center gap-1.5 text-xs border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={12} className={isReconnecting ? 'animate-spin' : ''} />
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
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

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

  const reconnectMutation = useMutation({
    mutationFn: (id: string) => api.post(`/settings/whatsapp/accounts/${id}/reconnect`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['wa-accounts'] }); toast.success('Reconnecting — scan QR when it appears'); },
    onError: () => toast.error('Failed to reconnect'),
  });

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center">
            <Smartphone size={20} className="text-violet-500" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">WhatsApp Accounts</h1>
            <p className="text-sm text-gray-500">
              {isAdmin ? 'All connected WhatsApp numbers across your team' : 'Your connected WhatsApp number'}
            </p>
          </div>
        </div>
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
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
            <AccountCard
              key={acc.id}
              account={acc}
              onDelete={(id) => deleteMutation.mutate(id)}
              onReconnect={(id) => reconnectMutation.mutate(id)}
              isReconnecting={reconnectMutation.isPending}
              showOwner={isAdmin}
            />
          ))}
        </div>
      )}
    </div>
  );
}
