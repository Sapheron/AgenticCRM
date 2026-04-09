'use client';

import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { useInboxStore } from '@/stores/inbox.store';
import { cn } from '@/lib/utils';
import { Bot, CheckCheck, Clock } from 'lucide-react';
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
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (messagesData) {
      setMessages(conversation.id, messagesData as unknown as Parameters<typeof setMessages>[1]);
    }
  }, [messagesData, conversation.id, setMessages]);

  const messagesLength = storeMessages[conversation.id]?.length;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messagesLength, isTyping]);

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
  const contactName = conversation.contact?.displayName ?? conversation.contact?.phoneNumber ?? 'Unknown';
  const contactInitial = contactName[0] ?? '#';

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600">
            {contactInitial}
          </div>
          <div>
            <p className="font-semibold text-sm text-gray-900">{contactName}</p>
            <p className="text-xs text-gray-500">{conversation.contact?.phoneNumber ?? ''} · {conversation.status ?? ''}</p>
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

      {/* AI Status Banner */}
      {conversation.aiEnabled && (
        <div className="bg-green-50 border-b border-green-200 px-4 py-2 flex items-center gap-2 text-green-700 text-xs">
          <Bot size={14} />
          <span className="font-medium">AI is handling this conversation automatically</span>
        </div>
      )}
      {conversation.status === 'WAITING_HUMAN' && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2 text-amber-700 text-xs">
          <Clock size={14} />
          <span className="font-medium">AI escalated — waiting for human agent</span>
        </div>
      )}

      {/* Messages (read-only) */}
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
                  : 'bg-green-100 text-green-900 rounded-tr-sm',
              )}
            >
              {msg.direction === 'OUTBOUND' && (
                <div className="flex items-center gap-1 mb-1">
                  <Bot size={10} className="text-green-600" />
                  <span className="text-xs text-green-600 font-medium">AI</span>
                </div>
              )}
              <p className="whitespace-pre-wrap">{msg.body ?? `[${msg.type ?? 'message'}]`}</p>
              <p className="text-xs mt-1 opacity-60">
                {msg.createdAt ? formatRelativeTime(msg.createdAt) : ''}
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
    </div>
  );
}
