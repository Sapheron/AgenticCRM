'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { toast } from 'sonner';
import { CreditCard, Copy, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const GATEWAYS = ['NONE', 'RAZORPAY', 'STRIPE', 'CASHFREE', 'PHONEPE', 'PAYU'];

export default function PaymentSettingsPage() {
  const [provider, setProvider] = useState('NONE');
  const [key, setKey] = useState('');
  const [secret, setSecret] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [testMode, setTestMode] = useState(true);
  const [webhookSecret, setWebhookSecret] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: config } = useQuery({
    queryKey: ['payment-config'],
    queryFn: async () => {
      const res = await api.get<{ data: { provider: string; keySet: boolean; currency: string; testMode: boolean; webhookUrl: string } }>('/settings/payments');
      return res.data.data;
    },
  });

  useEffect(() => {
    if (config) {
      setProvider(config.provider);
      setCurrency(config.currency);
      setTestMode(config.testMode);
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: () => api.put('/settings/payments', {
      provider,
      ...(key ? { key } : {}),
      ...(secret ? { secret } : {}),
      currency,
      testMode,
      ...(webhookSecret ? { webhookSecret } : {}),
    }),
    onSuccess: () => { toast.success('Payment settings saved'); setKey(''); setSecret(''); },
    onError: () => toast.error('Failed to save settings'),
  });

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post<{ data: { ok: boolean; error?: string } }>('/settings/payments/test');
      setTestResult(res.data.data);
    } catch {
      setTestResult({ ok: false, error: 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  const copyWebhookUrl = () => {
    if (config?.webhookUrl) {
      void navigator.clipboard.writeText(config.webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
          <CreditCard size={20} className="text-green-600" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Payment Gateway</h1>
          <p className="text-sm text-gray-500">Configure payment processing for AI-generated payment links</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div>
          <label className="text-sm font-medium text-gray-700">Payment Gateway</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
            {GATEWAYS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>

        {provider !== 'NONE' && (
          <>
            <div>
              <label className="text-sm font-medium text-gray-700">
                API Key / Key ID {config?.keySet && <span className="text-green-600 text-xs">(set)</span>}
              </label>
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={config?.keySet ? '••••••••••••' : 'Enter key'} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Secret Key</label>
              <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Enter secret" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Webhook Secret (for signature verification)</label>
              <input type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder="Webhook signing secret" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Default Currency</label>
                <input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="INR" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div className="flex items-center gap-2 mt-6">
                <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} className="rounded text-green-600" />
                <label className="text-sm text-gray-700">Test mode</label>
              </div>
            </div>

            {/* Webhook URL */}
            {config?.webhookUrl && (
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-sm font-medium text-blue-800 mb-2">Webhook URL</p>
                <p className="text-xs text-blue-600 mb-2">Copy this URL and paste it into your {provider.toLowerCase()} dashboard as a webhook endpoint.</p>
                <div className="flex items-center gap-2 bg-white rounded border border-blue-200 px-3 py-2">
                  <code className="text-xs text-gray-700 flex-1 truncate">{config.webhookUrl}</code>
                  <button onClick={copyWebhookUrl} className="text-blue-600 hover:text-blue-800 shrink-0">
                    {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            )}

            {testResult && (
              <div className={cn('flex items-center gap-2 p-3 rounded-lg text-sm', testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>
                {testResult.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
                {testResult.ok ? 'Connection successful!' : `Error: ${testResult.error}`}
              </div>
            )}
          </>
        )}

        <div className="flex gap-3 pt-2">
          {provider !== 'NONE' && (
            <button onClick={testConnection} disabled={testing} className="border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2">
              {testing ? <Loader2 size={14} className="animate-spin" /> : null}
              Test Connection
            </button>
          )}
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
