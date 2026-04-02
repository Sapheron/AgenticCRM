'use client';

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useInboxStore } from '@/stores/inbox.store';
import { useAuthStore } from '@/stores/auth.store';

let socket: Socket | null = null;

export function useSocket() {
  const { accessToken } = useAuthStore();
  const { addMessage, upsertConversation, setTyping } = useInboxStore();
  const initialized = useRef(false);

  useEffect(() => {
    if (!accessToken || initialized.current) return;
    initialized.current = true;

    socket = io(process.env.NEXT_PUBLIC_API_URL ?? '', {
      auth: { token: accessToken },
      transports: ['websocket'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    socket.on('connect', () => console.log('[WS] Connected'));
    socket.on('disconnect', () => console.log('[WS] Disconnected'));

    socket.on('message.new', ({ conversationId, message }: { conversationId: string; message: Parameters<typeof addMessage>[1] }) => {
      addMessage(conversationId, message);
      setTyping(conversationId, false);
    });

    socket.on('conversation.updated', ({ conversationId, changes }: { conversationId: string; changes: Partial<Parameters<typeof upsertConversation>[0]> }) => {
      // Update conversation in store
      useInboxStore.getState().upsertConversation({
        ...useInboxStore.getState().conversations.find((c) => c.id === conversationId)!,
        ...changes,
      });
    });

    socket.on('ai.typing', ({ conversationId }: { conversationId: string }) => {
      setTyping(conversationId, true);
      // Auto-clear after 15s if no message comes
      setTimeout(() => setTyping(conversationId, false), 15000);
    });

    return () => {
      socket?.disconnect();
      socket = null;
      initialized.current = false;
    };
  }, [accessToken]);

  return socket;
}

export function getSocket() {
  return socket;
}
