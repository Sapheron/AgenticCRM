import { create } from 'zustand';

interface Message {
  id: string;
  conversationId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  body?: string;
  isAiGenerated: boolean;
  status: string;
  createdAt: string;
}

interface Conversation {
  id: string;
  contactId: string;
  status: string;
  aiEnabled: boolean;
  lastMessageText?: string;
  lastMessageAt?: string;
  unreadCount: number;
  contact: { id: string; displayName?: string; phoneNumber: string; avatarUrl?: string };
  assignedAgent?: { id: string; firstName: string; lastName: string };
}

interface InboxState {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Record<string, Message[]>;
  typingConversations: Set<string>;

  setConversations: (conversations: Conversation[]) => void;
  upsertConversation: (conversation: Conversation) => void;
  setActiveConversation: (id: string | null) => void;
  addMessage: (conversationId: string, message: Message) => void;
  setMessages: (conversationId: string, messages: Message[]) => void;
  markAsRead: (conversationId: string) => void;
  setTyping: (conversationId: string, isTyping: boolean) => void;
}

export const useInboxStore = create<InboxState>((set) => ({
  conversations: [],
  activeConversationId: null,
  messages: {},
  typingConversations: new Set(),

  setConversations: (conversations) => set({ conversations }),

  upsertConversation: (conversation) =>
    set((state) => {
      const idx = state.conversations.findIndex((c) => c.id === conversation.id);
      const next = [...state.conversations];
      if (idx >= 0) {
        next[idx] = conversation;
      } else {
        next.unshift(conversation);
      }
      // Re-sort by lastMessageAt
      next.sort((a, b) =>
        new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime(),
      );
      return { conversations: next };
    }),

  setActiveConversation: (id) => set({ activeConversationId: id }),

  addMessage: (conversationId, message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: [...(state.messages[conversationId] ?? []), message],
      },
    })),

  setMessages: (conversationId, messages) =>
    set((state) => ({
      messages: { ...state.messages, [conversationId]: messages },
    })),

  markAsRead: (conversationId) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c,
      ),
    })),

  setTyping: (conversationId, isTyping) =>
    set((state) => {
      const next = new Set(state.typingConversations);
      if (isTyping) next.add(conversationId);
      else next.delete(conversationId);
      return { typingConversations: next };
    }),
}));
