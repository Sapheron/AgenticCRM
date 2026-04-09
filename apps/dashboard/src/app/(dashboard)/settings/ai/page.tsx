'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { toast } from 'sonner';
import { Bot, CheckCircle, XCircle, Loader2 } from 'lucide-react';

const PROVIDERS = [
  'GEMINI', 'OPENAI', 'ANTHROPIC', 'GROQ', 'DEEPSEEK',
  'XAI', 'MISTRAL', 'TOGETHER', 'MOONSHOT',
  'GLM', 'QWEN', 'STEPFUN',
  'OLLAMA', 'OPENROUTER', 'CUSTOM',
];

export default function AiSettingsPage() {
  const [provider, setProvider] = useState('GEMINI');
  const [model, setModel] = useState('gemini-2.0-flash');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful sales assistant.');
  const [maxTokens, setMaxTokens] = useState(1024);
  const [temperature, setTemperature] = useState(0.7);
  const [autoReply, setAutoReply] = useState(true);
  const [toolCalling, setToolCalling] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; latencyMs?: number } | null>(null);

  const { data: config } = useQuery({
    queryKey: ['ai-config'],
    queryFn: async () => {
      const res = await api.get<{ data: { provider: string; model: string; apiKeySet: boolean; baseUrl?: string; systemPrompt: string; maxTokens: number; temperature: number; autoReplyEnabled: boolean; toolCallingEnabled: boolean } }>('/settings/ai');
      return res.data.data;
    },
  });

  const { data: models } = useQuery({
    queryKey: ['ai-models', provider],
    queryFn: async () => {
      const res = await api.get<{ data: string[] }>(`/settings/ai/models?provider=${provider}`);
      return res.data.data;
    },
  });

  useEffect(() => {
    if (config) {
      setProvider(config.provider);
      setModel(config.model);
      setBaseUrl(config.baseUrl ?? '');
      setSystemPrompt(config.systemPrompt);
      setMaxTokens(config.maxTokens);
      setTemperature(config.temperature);
      setAutoReply(config.autoReplyEnabled);
      setToolCalling(config.toolCallingEnabled);
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: () => api.put('/settings/ai', {
      provider,
      model,
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      systemPrompt,
      maxTokens,
      temperature,
      autoReplyEnabled: autoReply,
      toolCallingEnabled: toolCalling,
    }),
    onSuccess: () => {
      toast.success('AI settings saved');
      setApiKey(''); // clear key field after save
    },
    onError: () => toast.error('Failed to save settings'),
  });

  const testAi = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post<{ data: { ok: boolean; error?: string; latencyMs?: number } }>('/settings/ai/test');
      setTestResult(res.data.data);
    } catch {
      setTestResult({ ok: false, error: 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center">
          <Bot size={20} className="text-violet-500" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">AI Model Settings</h1>
          <p className="text-sm text-gray-500">Configure the AI provider and behavior</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {/* Provider */}
        <div>
          <label className="text-sm font-medium text-gray-700">Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400"
          >
            {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        {/* Model */}
        <div>
          <label className="text-sm font-medium text-gray-700">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400"
          >
            {(models ?? [model]).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {/* API Key */}
        <div>
          <label className="text-sm font-medium text-gray-700">
            API Key {config?.apiKeySet && <span className="text-violet-500 text-xs">(set — enter new to change)</span>}
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config?.apiKeySet ? '••••••••••••••••' : 'Enter API key'}
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400"
          />
        </div>

        {(provider === 'OLLAMA' || provider === 'OPENROUTER' || provider === 'CUSTOM') && (
          <div>
            <label className="text-sm font-medium text-gray-700">Base URL</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434/v1"
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400"
            />
          </div>
        )}

        {/* System Prompt */}
        <div>
          <label className="text-sm font-medium text-gray-700">System Prompt</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={4}
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400 resize-none"
          />
        </div>

        {/* Settings */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Max Tokens</label>
            <input
              type="number"
              value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Temperature ({temperature})</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              className="mt-2 w-full"
            />
          </div>
        </div>

        {/* Toggles */}
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={autoReply} onChange={(e) => setAutoReply(e.target.checked)} className="rounded text-violet-500" />
            <span className="text-sm text-gray-700">Auto-reply enabled</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={toolCalling} onChange={(e) => setToolCalling(e.target.checked)} className="rounded text-violet-500" />
            <span className="text-sm text-gray-700">Tool calling enabled</span>
          </label>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${testResult.ok ? 'bg-violet-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {testResult.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
            {testResult.ok
              ? `Connection successful! Latency: ${testResult.latencyMs}ms`
              : `Error: ${testResult.error}`}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={testAi}
            disabled={testing}
            className="border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : null}
            Test Connection
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="bg-gray-900 hover:bg-gray-800 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
