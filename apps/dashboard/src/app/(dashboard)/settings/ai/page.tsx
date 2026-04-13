'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { toast } from 'sonner';
import { Bot, CheckCircle, XCircle, Loader2, Zap, Plus, Trash2, ArrowDown } from 'lucide-react';

const PROVIDERS: Array<{ value: string; label: string; desc: string }> = [
  { value: 'GEMINI', label: 'Google Gemini', desc: 'gemini-2.5-pro/flash — free tier available' },
  { value: 'OPENAI', label: 'OpenAI', desc: 'gpt-4.1, gpt-4o, o3, o4-mini' },
  { value: 'ANTHROPIC', label: 'Anthropic Claude', desc: 'claude-opus-4-6, claude-sonnet-4-6' },
  { value: 'GROQ', label: 'Groq', desc: 'llama-3.3-70b, mixtral — ultra fast' },
  { value: 'DEEPSEEK', label: 'DeepSeek', desc: 'deepseek-chat, deepseek-reasoner' },
  { value: 'XAI', label: 'xAI (Grok)', desc: 'grok-4, grok-3 — by Elon Musk' },
  { value: 'MISTRAL', label: 'Mistral', desc: 'mistral-large, codestral' },
  { value: 'TOGETHER', label: 'Together AI', desc: 'Llama-4, DeepSeek, Kimi — pay-per-token' },
  { value: 'MOONSHOT', label: 'Moonshot (Kimi)', desc: 'kimi-k2.5, kimi-k2-thinking' },
  { value: 'GLM', label: 'GLM (ZhipuAI)', desc: 'glm-5.1, glm-4.7 — Chinese AI' },
  { value: 'QWEN', label: 'Qwen (Alibaba)', desc: 'qwen-max, qwen-plus, qwen3.5' },
  { value: 'STEPFUN', label: 'StepFun', desc: 'step-2-16k, step-1-200k' },
  { value: 'OLLAMA', label: 'Ollama (Local)', desc: 'Self-hosted models — no API key needed' },
  { value: 'OPENROUTER', label: 'OpenRouter', desc: 'Access 100+ models with one key' },
  { value: 'CUSTOM', label: 'Custom (OpenAI-compatible)', desc: 'Any API with OpenAI format' },
];

const PROMPT_PRESETS = [
  { label: 'Sales Assistant', prompt: 'You are a friendly and professional sales assistant for a WhatsApp-based business. Help customers learn about products, answer questions, capture their contact info, and guide them toward a purchase. Be concise, warm, and proactive about offering help.' },
  { label: 'Customer Support', prompt: 'You are a helpful customer support agent. Listen carefully to issues, provide clear solutions, and escalate to a human agent when needed. Be empathetic, patient, and solution-oriented. Always confirm the issue is resolved before closing.' },
  { label: 'Lead Qualifier', prompt: 'You are a lead qualification assistant. Ask smart questions to understand the prospect\'s needs, budget, timeline, and decision-making process. Score leads based on their responses and create leads/deals in the CRM when qualified.' },
  { label: 'Appointment Setter', prompt: 'You are an appointment scheduling assistant. Help customers book meetings, consultations, or demos. Collect their name, phone, email, preferred date/time, and any notes. Create tasks in the CRM for follow-up.' },
  { label: 'Custom', prompt: '' },
];

interface FallbackEntry { provider: string; model: string; baseUrl?: string; apiKeySet: boolean; }

export default function AiSettingsPage() {
  const qc = useQueryClient();
  const [provider, setProvider] = useState('GEMINI');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('Custom');
  const [maxTokens, setMaxTokens] = useState(1024);
  const [temperature, setTemperature] = useState(0.7);
  const [autoReply, setAutoReply] = useState(true);
  const [toolCalling, setToolCalling] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; latencyMs?: number; reply?: string } | null>(null);

  // Fallback chain state
  const [fbProvider, setFbProvider] = useState('GROQ');
  const [fbModel, setFbModel] = useState('');
  const [fbApiKey, setFbApiKey] = useState('');
  const [fbBaseUrl, setFbBaseUrl] = useState('');

  const { data: fallbacks = [] } = useQuery<FallbackEntry[]>({
    queryKey: ['ai-fallbacks'],
    queryFn: async () => {
      const res = await api.get<{ data: FallbackEntry[] }>('/settings/ai/fallbacks');
      return res.data.data;
    },
  });

  const { data: fbModels = [] } = useQuery<string[]>({
    queryKey: ['ai-models', fbProvider],
    queryFn: async () => {
      const res = await api.get<{ data: string[] }>(`/settings/ai/models?provider=${fbProvider}`);
      return res.data.data;
    },
  });

  useEffect(() => {
    if (fbModels.length > 0) setFbModel(fbModels[0]);
  }, [fbModels]);

  const addFallbackMutation = useMutation({
    mutationFn: () => api.post('/settings/ai/fallbacks', {
      provider: fbProvider,
      model: fbModel,
      ...(fbApiKey ? { apiKey: fbApiKey } : {}),
      ...(fbBaseUrl ? { baseUrl: fbBaseUrl } : {}),
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ai-fallbacks'] });
      setFbApiKey(''); setFbBaseUrl('');
      toast.success('Fallback model added');
    },
    onError: () => toast.error('Failed to add fallback'),
  });

  const removeFallbackMutation = useMutation({
    mutationFn: (index: number) => api.delete(`/settings/ai/fallbacks/${index}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['ai-fallbacks'] }); toast.success('Fallback removed'); },
    onError: () => toast.error('Failed to remove fallback'),
  });

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
      // Detect preset
      const match = PROMPT_PRESETS.find((p) => p.prompt === config.systemPrompt);
      setSelectedPreset(match?.label ?? 'Custom');
    }
  }, [config]);

  // Auto-select first model when provider changes
  useEffect(() => {
    if (models && models.length > 0 && !models.includes(model)) {
      setModel(models[0]);
    }
  }, [models, model]);

  const saveMutation = useMutation({
    mutationFn: () => api.put('/settings/ai', {
      provider, model,
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      systemPrompt, maxTokens, temperature,
      autoReplyEnabled: autoReply, toolCallingEnabled: toolCalling,
    }),
    onSuccess: () => { toast.success('Settings saved'); setApiKey(''); },
    onError: () => toast.error('Failed to save'),
  });

  const testAi = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await api.post<{ data: { ok: boolean; error?: string; latencyMs?: number; reply?: string } }>('/settings/ai/test');
      setTestResult(res.data.data);
    } catch {
      setTestResult({ ok: false, error: 'Test request failed' });
    } finally { setTesting(false); }
  };

  const needsBaseUrl = provider === 'OLLAMA' || provider === 'CUSTOM';

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 border-b border-gray-200 px-4 flex items-center gap-2 shrink-0 bg-white">
        <Bot size={14} className="text-violet-500" />
        <span className="text-xs font-semibold text-gray-900">AI Configuration</span>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-2xl space-y-4">

          {/* Provider Selection */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Provider & Model</p>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="text-[11px] font-medium text-gray-600 mb-1 block">AI Provider</label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label} — {p.desc}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-medium text-gray-600 mb-1 block">Model</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
                >
                  {(models ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                {models && models.length === 0 && (
                  <p className="text-[10px] text-amber-500 mt-1">No models found for this provider</p>
                )}
              </div>

              <div>
                <label className="text-[11px] font-medium text-gray-600 mb-1 block">
                  API Key {config?.apiKeySet && <span className="text-violet-500">(configured)</span>}
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={config?.apiKeySet ? 'Enter new key to change...' : 'Paste your API key'}
                  className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400 placeholder:text-gray-300"
                />
              </div>

              {needsBaseUrl && (
                <div>
                  <label className="text-[11px] font-medium text-gray-600 mb-1 block">
                    Base URL {provider === 'OLLAMA' && <span className="text-gray-400">(default: http://localhost:11434/v1)</span>}
                  </label>
                  <input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="http://localhost:11434/v1"
                    className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
                  />
                </div>
              )}
            </div>
          </div>

          {/* System Prompt */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">System Prompt</p>
            <div className="flex gap-1.5 mb-3 flex-wrap">
              {PROMPT_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => {
                    setSelectedPreset(preset.label);
                    if (preset.prompt) setSystemPrompt(preset.prompt);
                  }}
                  className={`text-[10px] px-2 py-1 rounded transition ${
                    selectedPreset === preset.label
                      ? 'bg-violet-100 text-violet-700 font-medium'
                      : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <textarea
              value={systemPrompt}
              onChange={(e) => { setSystemPrompt(e.target.value); setSelectedPreset('Custom'); }}
              rows={5}
              placeholder="Instructions for the AI assistant..."
              className="w-full border border-gray-200 rounded px-2.5 py-2 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none placeholder:text-gray-300"
            />
            <p className="text-[9px] text-gray-400 mt-1">
              This prompt defines how the AI behaves when replying to WhatsApp messages and in the admin chat.
            </p>
          </div>

          {/* Advanced Settings */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Advanced</p>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-[11px] font-medium text-gray-600 mb-1 block">Max Output Tokens</label>
                <input
                  type="number"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                  min={64} max={8192}
                  className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
                />
                <p className="text-[9px] text-gray-400 mt-0.5">64 – 8192</p>
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-600 mb-1 block">Temperature: {temperature}</label>
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="w-full mt-1 accent-violet-500"
                />
                <div className="flex justify-between text-[9px] text-gray-400">
                  <span>Precise</span>
                  <span>Creative</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={autoReply} onChange={(e) => setAutoReply(e.target.checked)} className="rounded text-violet-500 w-3.5 h-3.5" />
                <div>
                  <span className="text-xs text-gray-700 block">Auto-reply to WhatsApp</span>
                  <span className="text-[9px] text-gray-400">AI responds automatically to incoming messages</span>
                </div>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={toolCalling} onChange={(e) => setToolCalling(e.target.checked)} className="rounded text-violet-500 w-3.5 h-3.5" />
                <div>
                  <span className="text-xs text-gray-700 block">CRM Tool Calling</span>
                  <span className="text-[9px] text-gray-400">AI can create leads, deals, tasks from chats</span>
                </div>
              </label>
            </div>
          </div>

          {/* Fallback Model Chain */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Fallback Models</p>
              <span className="text-[9px] text-gray-400">{fallbacks.length}/5</span>
            </div>
            <p className="text-[10px] text-gray-400 mb-3">
              Tried in order when the primary model returns 503 / rate-limit / overloaded. Uses the primary API key unless you specify a different one.
            </p>

            {/* Current chain */}
            {fallbacks.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {/* Primary */}
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-violet-50 border border-violet-100">
                  <div className="w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
                  <span className="text-[11px] font-medium text-violet-700 flex-1">
                    {provider} / {model} <span className="font-normal text-violet-400">(primary)</span>
                  </span>
                </div>
                {fallbacks.map((fb, i) => (
                  <div key={i}>
                    <div className="flex justify-center my-0.5">
                      <ArrowDown size={10} className="text-gray-300" />
                    </div>
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-gray-50 border border-gray-200">
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0" />
                      <span className="text-[11px] text-gray-700 flex-1">
                        {fb.provider} / {fb.model}
                        {fb.apiKeySet && <span className="text-[9px] text-gray-400 ml-1">(own key)</span>}
                      </span>
                      <button
                        onClick={() => removeFallbackMutation.mutate(i)}
                        disabled={removeFallbackMutation.isPending}
                        className="text-red-400 hover:text-red-600 disabled:opacity-40"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add fallback form */}
            {fallbacks.length < 5 && (
              <div className="border border-dashed border-gray-200 rounded p-3 space-y-2">
                <p className="text-[10px] font-medium text-gray-500">Add fallback</p>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={fbProvider}
                    onChange={(e) => setFbProvider(e.target.value)}
                    className="border border-gray-200 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-violet-400"
                  >
                    {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                  <select
                    value={fbModel}
                    onChange={(e) => setFbModel(e.target.value)}
                    className="border border-gray-200 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-violet-400"
                  >
                    {fbModels.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <input
                  type="password"
                  value={fbApiKey}
                  onChange={(e) => setFbApiKey(e.target.value)}
                  placeholder="API key (optional — uses primary key if blank)"
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-violet-400 placeholder:text-gray-300"
                />
                {(fbProvider === 'OLLAMA' || fbProvider === 'CUSTOM') && (
                  <input
                    value={fbBaseUrl}
                    onChange={(e) => setFbBaseUrl(e.target.value)}
                    placeholder="Base URL (e.g. http://localhost:11434/v1)"
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-violet-400"
                  />
                )}
                <button
                  onClick={() => addFallbackMutation.mutate()}
                  disabled={addFallbackMutation.isPending || !fbModel}
                  className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-3 py-1.5 rounded text-[11px] font-medium disabled:opacity-50"
                >
                  {addFallbackMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  Add Fallback
                </button>
              </div>
            )}
          </div>

          {/* Test + Save */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            {testResult && (
              <div className={`flex items-start gap-2 p-2.5 rounded text-xs mb-3 ${testResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {testResult.ok ? <CheckCircle size={14} className="shrink-0 mt-0.5" /> : <XCircle size={14} className="shrink-0 mt-0.5" />}
                <div>
                  {testResult.ok
                    ? <span>Connected! Latency: {testResult.latencyMs}ms {testResult.reply && `— "${testResult.reply}"`}</span>
                    : <span>Error: {testResult.error}</span>}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={testAi}
                disabled={testing}
                className="flex items-center gap-1.5 border border-gray-200 text-gray-700 px-3 py-1.5 rounded text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                {testing ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                Test Connection
              </button>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="flex-1 bg-gray-900 hover:bg-gray-800 text-white px-4 py-1.5 rounded text-xs font-medium disabled:opacity-50"
              >
                {saveMutation.isPending ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
