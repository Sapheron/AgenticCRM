'use client';

/**
 * Leads → API Keys page.
 *
 * Dedicated API key management: generate, list, revoke. No docs here —
 * the Documentation button in the header opens the full API reference.
 * This page is NOT gated by public URL eligibility since keys work without one.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import api from '@/lib/api-client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  ArrowLeft, Plus, Copy, Check, Trash2, Key, BookOpen, X, Eye, EyeOff,
} from 'lucide-react';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  isActive: boolean;
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
}
interface ApiKeyWithSecret extends ApiKey {
  key?: string;
}

const SCOPE_OPTIONS = [
  'leads:write',
  'leads:read',
  'webhooks:meta',
  'forms:write',
  'forms:read',
];

export default function LeadsApiKeysPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createdKey, setCreatedKey] = useState<ApiKeyWithSecret | null>(null);

  const { data: apiKeys, isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const r = await api.get<{ data: ApiKey[] }>('/api-keys');
      return r.data.data;
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api-keys/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('API key revoked');
    },
  });

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center gap-2 shrink-0 bg-white">
        <button
          onClick={() => router.push('/leads')}
          className="text-gray-400 hover:text-gray-600"
          title="Back to leads"
        >
          <ArrowLeft size={14} />
        </button>
        <Key size={14} className="text-violet-500" />
        <span className="text-xs font-semibold text-gray-900">Leads — API Keys</span>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/leads/api-docs"
            className="flex items-center gap-1 border border-gray-200 hover:border-violet-300 hover:bg-violet-50 text-gray-700 px-2.5 py-1 rounded text-[11px] font-medium"
          >
            <BookOpen size={11} /> Documentation
          </Link>
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium"
          >
            <Plus size={11} /> Generate Key
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-gray-50/50">
        <div className="max-w-4xl mx-auto p-6 space-y-4">
          {/* Intro card */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h1 className="text-sm font-semibold text-gray-900 mb-1">API Keys</h1>
            <p className="text-xs text-gray-600 leading-relaxed">
              Generate keys to authenticate external integrations (custom webhooks, Tally, Typeform,
              Zapier, n8n, your own scripts). Keys are SHA-256 hashed at rest and the raw value is
              shown only once at creation time.
            </p>
            <div className="mt-3 flex items-center gap-2 text-[10px] text-gray-500">
              <span className="bg-gray-100 px-2 py-0.5 rounded">
                Header: <code>Authorization: Bearer wacrm_&lt;key&gt;</code>
              </span>
            </div>
          </div>

          {/* Keys table */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            {isLoading ? (
              <p className="text-[11px] text-gray-300 text-center py-8">Loading…</p>
            ) : !apiKeys?.length ? (
              <div className="text-center py-10">
                <Key size={24} className="mx-auto text-gray-300 mb-2" />
                <p className="text-xs font-medium text-gray-600">No API keys yet</p>
                <p className="text-[11px] text-gray-400 mt-1">
                  Click <strong>Generate Key</strong> above to create your first key.
                </p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="border-b border-gray-200">
                  <tr>
                    {['Name', 'Prefix', 'Scopes', 'Created', 'Last used', ''].map((h) => (
                      <th
                        key={h}
                        className="text-left px-3 py-2 text-[9px] font-medium text-gray-400 uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {apiKeys.map((k) => (
                    <tr key={k.id} className={cn(!k.isActive && 'opacity-50')}>
                      <td className="px-3 py-2.5 text-[11px] text-gray-900 font-medium">{k.name}</td>
                      <td className="px-3 py-2.5 text-[10px] font-mono text-gray-500">{k.prefix}…</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {k.scopes.length === 0 ? (
                            <span className="text-[10px] text-gray-300">none</span>
                          ) : (
                            k.scopes.map((s) => (
                              <span
                                key={s}
                                className="text-[9px] bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded"
                              >
                                {s}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[10px] text-gray-400">
                        {new Date(k.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2.5 text-[10px] text-gray-400">
                        {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never'}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={() => {
                            if (
                              confirm(
                                'Revoke this key? Existing integrations using it will stop working.',
                              )
                            ) {
                              revokeMutation.mutate(k.id);
                            }
                          }}
                          className="text-gray-400 hover:text-red-500"
                          title="Revoke"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showCreateForm && (
        <CreateApiKeyModal
          onClose={() => setShowCreateForm(false)}
          onCreated={(key) => {
            setCreatedKey(key);
            setShowCreateForm(false);
          }}
        />
      )}

      {createdKey && (
        <ApiKeyCreatedModal apiKey={createdKey} onClose={() => setCreatedKey(null)} />
      )}
    </div>
  );
}

// ── Modals ──────────────────────────────────────────────────────────────────

function CreateApiKeyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (k: ApiKeyWithSecret) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['leads:write']);
  const [expiresAt, setExpiresAt] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ data: ApiKeyWithSecret }>('/api-keys', {
        name,
        scopes,
        expiresAt: expiresAt || undefined,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['api-keys'] });
      onCreated(r.data.data);
      toast.success('API key created');
    },
    onError: () => toast.error('Failed to create key'),
  });

  const toggleScope = (scope: string) => {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  return (
    <Modal title="Generate API Key" onClose={onClose}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Key name (e.g. Tally form)"
        className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
      />
      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">Scopes</p>
        <div className="flex flex-wrap gap-1">
          {SCOPE_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggleScope(s)}
              className={cn(
                'text-[10px] px-2 py-0.5 rounded border',
                scopes.includes(s)
                  ? 'bg-violet-100 text-violet-700 border-violet-300'
                  : 'bg-white text-gray-500 border-gray-200',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">Expires (optional)</p>
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="border border-gray-200 rounded px-2.5 py-1.5 text-xs"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className="text-gray-500 text-[11px] px-2 py-1">
          Cancel
        </button>
        <button
          onClick={() => mutation.mutate()}
          disabled={!name || scopes.length === 0 || mutation.isPending}
          className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30"
        >
          {mutation.isPending ? 'Generating…' : 'Generate'}
        </button>
      </div>
    </Modal>
  );
}

function ApiKeyCreatedModal({
  apiKey,
  onClose,
}: {
  apiKey: ApiKeyWithSecret;
  onClose: () => void;
}) {
  const [revealed, setRevealed] = useState(true);
  return (
    <Modal title="Your new API key" onClose={onClose}>
      <div className="border border-amber-200 bg-amber-50 rounded p-2 text-[10px] text-amber-800 leading-relaxed">
        ⚠️ This is the only time you&apos;ll see this key. Copy it now and store it somewhere safe.
      </div>
      <CopyField
        label="API Key"
        value={apiKey.key ?? ''}
        mono
        masked={!revealed}
        onToggleMask={() => setRevealed(!revealed)}
      />
      <p className="text-[11px] text-gray-500 leading-relaxed">
        Send it as <code className="bg-gray-100 px-1 rounded">Authorization: Bearer wacrm_…</code>{' '}
        on every request. See{' '}
        <Link href="/leads/api-docs" className="text-violet-600 underline">
          Documentation
        </Link>{' '}
        for full endpoint reference.
      </p>
      <div className="flex justify-end pt-1">
        <button onClick={onClose} className="bg-gray-900 text-white px-3 py-1 rounded text-[11px]">
          Done
        </button>
      </div>
    </Modal>
  );
}

// ── Reusable bits ───────────────────────────────────────────────────────────

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[480px] p-4 space-y-3 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-xs font-semibold">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CopyField({
  label,
  value,
  masked = false,
  onToggleMask,
  mono = false,
}: {
  label: string;
  value: string;
  masked?: boolean;
  onToggleMask?: () => void;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const display = masked ? '•'.repeat(Math.min(40, value.length)) : value;

  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">{label}</p>
      <div className="flex items-center gap-1">
        <input
          readOnly
          value={display}
          className={cn(
            'flex-1 border border-gray-200 rounded px-2 py-1 text-[11px] bg-gray-50',
            mono && 'font-mono',
          )}
        />
        {onToggleMask && (
          <button
            onClick={onToggleMask}
            className="text-gray-400 hover:text-violet-500 p-1"
            title={masked ? 'Show' : 'Hide'}
          >
            {masked ? <Eye size={11} /> : <EyeOff size={11} />}
          </button>
        )}
        <button
          onClick={() => {
            void navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
            toast.success('Copied');
          }}
          className="text-gray-400 hover:text-violet-500 p-1"
        >
          {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
        </button>
      </div>
    </div>
  );
}
