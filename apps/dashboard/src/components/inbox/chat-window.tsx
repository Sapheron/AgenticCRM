'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { useInboxStore } from '@/stores/inbox.store';
import { cn } from '@/lib/utils';
import { Send, Bot, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { formatRelativeTime } from '@/lib/utils';

interface Conversation {
  id: string;
  status: string;
  aiEnabled: boolean;
  contact: { id: string; displayName?: string; phoneNumber: string };
  assignedAgent?: { firstName: string; lastName: string };
}

interface Message {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  body?: string;
  isAiGenerated: boolean;
  status: string;
  createdAt: string;
  type: string;
}

export function ChatWindow({ conversation }: { conversation: Conversation }) {
  const [messageText, setMessageText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const { messages: storeMessages, setMessages, typingConversations } = useInboxStore();
  const isTyping = typingConversations.has(conversation.id);

  const { data: messagesData } = useQuery({
    queryKey: ['messages', conversation.id],
    queryFn: async () => {
      const res = await api.get<{ data: Message[] }>(`/conversations/${conversation.id}/messages`);
      return res.data.data;
    },
  });

  useEffect(() => {
    if (messagesData) {
      setMessages(conversation.id, messagesData as unknown as Parameters<typeof setMessages>[1]);
    }
  }, [messagesData, conversation.id, setMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [storeMessages[conversation.id]?.length, isTyping]);

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      await api.post(`/messages/send`, {
        conversationId: conversation.id,
        text,
      });
    },
    onSuccess: () => {
      setMessageText('');
      void qc.invalidateQueries({ queryKey: ['messages', conversation.id] });
    },
    onError: () => toast.error('Failed to send message'),
  });

  const toggleAiMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/conversations/${conversation.id}/toggle-ai`, {
        enabled: !conversation.aiEnabled,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      toast.success(`AI ${conversation.aiEnabled ? 'disabled' : 'enabled'}`);
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/conversations/${conversation.id}/resolve`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      toast.success('Conversation resolved');
    },
  });

  const displayMessages = storeMessages[conversation.id] ?? [];

  const handleSend = () => {
    if (!messageText.trim()) return;
    sendMutation.mutate(messageText.trim());
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600">
            {conversation.contact.displayName?.[0] ?? '#'}
          </div>
          <div>
            <p className="font-semibold text-sm text-gray-900">
              {conversation.contact.displayName ?? conversation.contact.phoneNumber}
            </p>
            <p className="text-xs text-gray-500">{conversation.contact.phoneNumber} · {conversation.status}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => toggleAiMutation.mutate()}
            className={cn(
              'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition',
              conversation.aiEnabled
                ? 'border-green-300 text-green-700 bg-green-50 hover:bg-green-100'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50',
            )}
          >
            <Bot size={12} />
            {conversation.aiEnabled ? 'AI On' : 'AI Off'}
          </button>
          <button
            onClick={() => resolveMutation.mutate()}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            <CheckCheck size={12} />
            Resolve
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {displayMessages.map((msg) => (
          <div
            key={msg.id}
            className={cn('flex', msg.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-xs lg:max-w-md px-3 py-2 rounded-2xl text-sm',
                msg.direction === 'INBOUND'
                  ? 'bg-white text-gray-900 rounded-tl-sm shadow-sm'
                  : msg.isAiGenerated
                  ? 'bg-green-100 text-green-900 rounded-tr-sm'
                  : 'bg-green-600 text-white rounded-tr-sm',
              )}
            >
              {msg.isAiGenerated && (
                <div className="flex items-center gap-1 mb-1">
                  <Bot size={10} className="text-green-600" />
                  <span className="text-xs text-green-600 font-medium">AI</span>
                </div>
              )}
              <p className="whitespace-pre-wrap">{msg.body ?? `[${msg.type}]`}</p>
              <p className={cn('text-xs mt-1 opacity-60')}>
                {formatRelativeTime(msg.createdAt)}
              </p>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-end">
            <div className="bg-green-100 text-green-700 px-3 py-2 rounded-2xl rounded-tr-sm text-sm flex items-center gap-2">
              <Bot size={12} />
              <span className="italic text-xs">AI is typing…</span>
              <span className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 bg-green-500 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Message input */}
      <div className="bg-white border-t px-4 py-3">
        <div className="flex items-end gap-3">
          <textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
            rows={1}
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-500 max-h-32"
          />
          <button
            onClick={handleSend}
            disabled={!messageText.trim() || sendMutation.isPending}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl p-2 transition shrink-0"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
