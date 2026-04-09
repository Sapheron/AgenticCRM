'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { useInboxStore } from '@/stores/inbox.store';
import { formatRelativeTime, cn } from '@/lib/utils';
import { Search, Bot, MessageSquare } from 'lucide-react';
import { ChatWindow } from '@/components/inbox/chat-window';

export default function InboxPage() {
  const [search, setSearch] = useState('');
  const { conversations, setConversations, activeConversationId, setActiveConversation } = useInboxStore();

  const { data } = useQuery({
    queryKey: ['conversations', search],
    queryFn: async () => {
      const res = await api.get<{ data: { items: typeof conversations } }>('/conversations', {
        params: { search: search || undefined },
      });
      return res.data.data.items;
    },
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (data) setConversations(data);
  }, [data, setConversations]);

  const activeConv = conversations.find((c) => c.id === activeConversationId);

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className="w-80 bg-white border-r flex flex-col shrink-0">
        <div className="p-4 border-b">
          <h1 className="font-semibold text-gray-900 mb-3">AI Chats</h1>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations…"
              className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => setActiveConversation(conv.id)}
              className={cn(
                'w-full text-left p-4 hover:bg-gray-50 transition-colors',
                activeConversationId === conv.id && 'bg-green-50',
              )}
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center shrink-0 text-sm font-medium text-gray-600">
                  {conv.contact?.displayName?.[0] ?? conv.contact?.phoneNumber?.[0] ?? '#'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-medium text-sm text-gray-900 truncate">
                      {conv.contact?.displayName ?? conv.contact?.phoneNumber ?? 'Unknown'}
                    </span>
                    {conv.lastMessageAt && (
                      <span className="text-xs text-gray-400 shrink-0 ml-2">
                        {formatRelativeTime(conv.lastMessageAt)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {conv.aiEnabled && <Bot size={10} className="text-green-500 shrink-0" />}
                    <p className="text-xs text-gray-500 truncate">{conv.lastMessageText}</p>
                    {conv.unreadCount > 0 && (
                      <span className="ml-auto shrink-0 bg-green-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                        {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat window */}
      <div className="flex-1">
        {activeConv ? (
          <ChatWindow conversation={activeConv} />
        ) : (
          <div className="h-full flex items-center justify-center text-gray-400">
            <div className="text-center">
              <MessageSquare size={48} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">Select a conversation</p>
              <p className="text-sm mt-1">AI handles all replies automatically</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
