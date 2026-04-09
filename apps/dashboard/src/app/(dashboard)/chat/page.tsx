'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { Bot, Send, Trash2, Loader2, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const PROVIDERS = [
  'GEMINI', 'OPENAI', 'ANTHROPIC', 'GROQ', 'DEEPSEEK',
  'XAI', 'MISTRAL', 'TOGETHER', 'MOONSHOT',
  'OLLAMA', 'OPENROUTER', 'CUSTOM',
];

export default function AiChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load current AI config to show which provider is active
  const { data: config } = useQuery({
    queryKey: ['ai-config'],
    queryFn: async () => {
      const res = await api.get<{ data: { provider: string; model: string; apiKeySet: boolean } }>('/settings/ai');
      return res.data.data;
    },
  });

  // Load models for the active provider
  const provider = selectedProvider || config?.provider || 'GEMINI';
  const { data: models } = useQuery({
    queryKey: ['ai-models', provider],
    queryFn: async () => {
      const res = await api.get<{ data: string[] }>(`/settings/ai/models?provider=${provider}`);
      return res.data.data;
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const chatMutation = useMutation({
    mutationFn: async (userMessage: string) => {
      const newMessages: ChatMessage[] = [...messages, { role: 'user', content: userMessage }];
      setMessages(newMessages);
      setInput('');

      const res = await api.post<{ data: { content: string; provider: string; model: string; latencyMs: number } }>(
        '/ai/chat',
        { messages: newMessages },
      );
      return res.data.data;
    },
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: 'assistant', content: data.content }]);
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Failed to get response. Check your AI settings and API key.' },
      ]);
    },
  });

  const handleSend = () => {
    if (!input.trim() || chatMutation.isPending) return;
    chatMutation.mutate(input.trim());
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center">
            <Bot size={18} className="text-green-600" />
          </div>
          <div>
            <h1 className="font-semibold text-sm text-gray-900">AI Chat</h1>
            <p className="text-xs text-gray-500">
              {config?.provider ?? 'Not configured'} · {config?.model ?? '—'}
              {config?.apiKeySet ? '' : ' · No API key set'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMessages([])}
            disabled={messages.length === 0}
            className="flex items-center gap-1.5 text-xs border border-gray-200 text-gray-600 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            <Trash2 size={12} />
            Clear
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md">
              <Bot size={48} className="mx-auto mb-4 text-gray-300" />
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Chat with AI</h2>
              <p className="text-sm text-gray-500 mb-4">
                Send a message to chat with your configured AI model.
                Change providers and models in Settings &rarr; AI.
              </p>
              {!config?.apiKeySet && (
                <a
                  href="/settings/ai"
                  className="inline-flex items-center gap-2 text-sm text-green-600 hover:text-green-700 font-medium"
                >
                  Set up AI provider &rarr;
                </a>
              )}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            <div className={cn('flex items-start gap-2 max-w-xl')}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot size={14} className="text-green-600" />
                </div>
              )}
              <div
                className={cn(
                  'px-4 py-3 rounded-2xl text-sm leading-relaxed',
                  msg.role === 'user'
                    ? 'bg-green-600 text-white rounded-tr-sm'
                    : 'bg-white text-gray-900 rounded-tl-sm shadow-sm border border-gray-100',
                )}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
              {msg.role === 'user' && (
                <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center shrink-0 mt-0.5">
                  <User size={14} className="text-gray-600" />
                </div>
              )}
            </div>
          </div>
        ))}

        {chatMutation.isPending && (
          <div className="flex justify-start">
            <div className="flex items-start gap-2">
              <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                <Bot size={14} className="text-green-600" />
              </div>
              <div className="bg-white text-gray-500 px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm border border-gray-100 text-sm flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                Thinking…
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="bg-white border-t px-4 py-3 shrink-0">
        <div className="flex items-end gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={config?.apiKeySet ? 'Type a message… (Enter to send)' : 'Set up AI provider in Settings first'}
            disabled={!config?.apiKeySet}
            rows={1}
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-500 max-h-32 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || chatMutation.isPending || !config?.apiKeySet}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-xl p-2.5 transition shrink-0"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
