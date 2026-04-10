'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { Bot, Send, Plus, Trash2, Loader2, User, Wrench, MessageSquare, Paperclip, X, Image as ImageIcon, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ToolAction { tool: string; args: Record<string, unknown>; result: string; }
interface PersistedAttachment {
  kind: 'image' | 'text';
  mimeType: string;
  fileName: string;
  size: number;
  text?: string;
}
interface RawAttachment extends PersistedAttachment {
  /** Local preview URL for images (object URL); not sent to server. */
  previewUrl?: string;
  /** Base64 payload sent to server. Stripped from persisted version. */
  dataBase64: string;
}
interface ChatMsg {
  id: string;
  role: string;
  content: string;
  toolCalls?: ToolAction[];
  attachments?: PersistedAttachment[];
  createdAt: string;
}
interface Conv { id: string; title: string; updatedAt: string; }

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 8;
const TEXT_EXT = /\.(txt|md|markdown|json|jsonl|ya?ml|toml|ini|csv|tsv|log|env|jsx?|tsx?|mjs|cjs|py|rb|go|rs|java|kt|cs|cpp|c|h|hpp|php|swift|scala|sh|bash|zsh|fish|ps1|sql|graphql|gql|proto|html?|css|s[ac]ss|less|xml|svg|dockerfile|gitignore|editorconfig)$/i;

function classifyFile(file: File): 'image' | 'text' | null {
  if (file.type.startsWith('image/')) return 'image';
  if (
    file.type.startsWith('text/') ||
    file.type === 'application/json' ||
    file.type === 'application/xml' ||
    file.type === 'application/javascript' ||
    file.type === 'application/x-yaml' ||
    file.type === 'application/csv'
  ) return 'text';
  if (TEXT_EXT.test(file.name)) return 'text';
  return null;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  // btoa needs a binary string; build it in chunks to avoid stack overflow on big files.
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export default function AiChatPage() {
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [pendingMsgs, setPendingMsgs] = useState<Array<{ role: string; content: string; toolCalls?: ToolAction[]; attachments?: PersistedAttachment[] }>>([]);
  const [pendingAttachments, setPendingAttachments] = useState<RawAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { data: config } = useQuery({
    queryKey: ['ai-config'],
    queryFn: async () => { const r = await api.get<{ data: { provider: string; model: string; apiKeySet: boolean } }>('/settings/ai'); return r.data.data; },
  });

  const { data: conversations } = useQuery({
    queryKey: ['chat-conversations'],
    queryFn: async () => { const r = await api.get<{ data: Conv[] }>('/chat/conversations'); return r.data.data; },
  });

  const { data: messages } = useQuery({
    queryKey: ['chat-messages', activeConvId],
    queryFn: async () => {
      if (!activeConvId) return [];
      const r = await api.get<{ data: ChatMsg[] }>(`/chat/conversations/${activeConvId}/messages`);
      return r.data.data;
    },
    enabled: !!activeConvId,
  });

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, pendingMsgs]);

  const createConvMutation = useMutation({
    mutationFn: async () => { const r = await api.post<{ data: Conv }>('/chat/conversations'); return r.data.data; },
    onSuccess: (conv) => {
      void qc.invalidateQueries({ queryKey: ['chat-conversations'] });
      setActiveConvId(conv.id);
      setPendingMsgs([]);
    },
  });

  const deleteConvMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/chat/conversations/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat-conversations'] });
      if (activeConvId) setActiveConvId(null);
      setPendingMsgs([]);
    },
  });

  const chatMutation = useMutation({
    mutationFn: async ({ userMessage, attachments }: { userMessage: string; attachments: RawAttachment[] }) => {
      if (!activeConvId) return null;

      // Build the message history for the request. Only the LAST user message
      // carries the new attachments — historical messages from the DB don't
      // need their attachments re-sent (the model already saw them).
      const history = (messages || []).map((m) => ({ role: m.role, content: m.content }));
      const newMsg = {
        role: 'user',
        content: userMessage,
        attachments: attachments.map((a) => ({
          mimeType: a.mimeType,
          fileName: a.fileName,
          dataBase64: a.dataBase64,
        })),
      };
      const allMsgs = [...history, ...pendingMsgs.map((p) => ({ role: p.role, content: p.content })), newMsg];

      // Optimistic UI: show the new user message immediately with persisted-style attachments
      const optimistic: PersistedAttachment[] = attachments.map((a) => ({
        kind: a.kind,
        mimeType: a.mimeType,
        fileName: a.fileName,
        size: a.size,
        ...(a.kind === 'text' ? { text: a.text } : {}),
      }));
      setPendingMsgs((p) => [...p, { role: 'user', content: userMessage, attachments: optimistic.length ? optimistic : undefined }]);
      setInput('');
      setPendingAttachments([]);

      const r = await api.post<{ data: { content: string; actions: ToolAction[]; provider: string; model: string; latencyMs: number } }>(
        '/ai/chat',
        { messages: allMsgs, conversationId: activeConvId },
      );
      return r.data.data;
    },
    onSuccess: (data) => {
      if (!data) return;
      setPendingMsgs([]);
      void qc.invalidateQueries({ queryKey: ['chat-messages', activeConvId] });
      void qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
    onError: (err: unknown) => {
      const msg = (err && typeof err === 'object' && 'response' in err
        ? ((err as { response?: { data?: { message?: string } } }).response?.data?.message)
        : null) ?? 'Failed to get response.';
      setPendingMsgs((p) => [...p, { role: 'assistant', content: msg }]);
    },
  });

  const addFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    const room = MAX_ATTACHMENTS - pendingAttachments.length;
    if (room <= 0) {
      toast.error(`Max ${MAX_ATTACHMENTS} attachments per message`);
      return;
    }

    const newOnes: RawAttachment[] = [];
    for (const file of arr.slice(0, room)) {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`${file.name} is too large (max 5 MB)`);
        continue;
      }
      const kind = classifyFile(file);
      if (!kind) {
        toast.error(`${file.name}: unsupported type. Use images or text/code files.`);
        continue;
      }
      try {
        const dataBase64 = await fileToBase64(file);
        const att: RawAttachment = {
          kind,
          mimeType: file.type || (kind === 'text' ? 'text/plain' : 'application/octet-stream'),
          fileName: file.name,
          size: file.size,
          dataBase64,
          ...(kind === 'image' ? { previewUrl: URL.createObjectURL(file) } : {}),
          ...(kind === 'text' ? { text: await file.text() } : {}),
        };
        newOnes.push(att);
      } catch {
        toast.error(`${file.name}: failed to read`);
      }
    }
    if (newOnes.length) setPendingAttachments((prev) => [...prev, ...newOnes]);
  };

  const removeAttachment = (idx: number) => {
    setPendingAttachments((prev) => {
      const next = prev.slice();
      const removed = next.splice(idx, 1);
      removed.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
      return next;
    });
  };

  const handleSend = () => {
    if ((!input.trim() && pendingAttachments.length === 0) || chatMutation.isPending) return;
    if (!activeConvId) { toast.error('Create a new chat first'); return; }
    chatMutation.mutate({ userMessage: input.trim(), attachments: pendingAttachments });
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = items
      .filter((it) => it.kind === 'file')
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length > 0) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      pendingAttachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allMessages = [
    ...(messages || []).map((m) => ({
      role: m.role,
      content: m.content,
      toolCalls: (m.toolCalls as ToolAction[] | null) ?? undefined,
      attachments: (m.attachments as PersistedAttachment[] | null) ?? undefined,
    })),
    ...pendingMsgs,
  ];

  return (
    <div className="flex h-full">
      {/* Sidebar: conversations */}
      <div className="w-52 border-r border-gray-200 bg-white flex flex-col shrink-0">
        <div className="h-11 border-b border-gray-200 px-3 flex items-center justify-between shrink-0">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Chats</span>
          <button onClick={() => createConvMutation.mutate()} className="text-gray-400 hover:text-violet-500 p-0.5" title="New Chat">
            <Plus size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {!conversations?.length ? (
            <div className="p-3 text-center">
              <p className="text-[10px] text-gray-300 mb-2">No chats yet</p>
              <button onClick={() => createConvMutation.mutate()} className="text-[10px] text-violet-500 hover:text-violet-600">
                + New Chat
              </button>
            </div>
          ) : (
            <div className="py-1">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => { setActiveConvId(conv.id); setPendingMsgs([]); }}
                  className={cn(
                    'group flex items-center gap-1.5 px-3 py-2 cursor-pointer text-xs transition-colors',
                    activeConvId === conv.id ? 'bg-violet-50 text-violet-700' : 'text-gray-600 hover:bg-gray-50',
                  )}
                >
                  <MessageSquare size={11} className="shrink-0 text-gray-300" />
                  <span className="flex-1 truncate">{conv.title}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteConvMutation.mutate(conv.id); }}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 p-0.5"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        <div className="h-11 border-b border-gray-200 px-4 flex items-center gap-2 shrink-0 bg-white">
          <Bot size={14} className="text-violet-500" />
          <span className="text-xs font-semibold text-gray-900">AI Assistant</span>
          {config && (
            <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
              {config.provider} / {config.model}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {!activeConvId ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-sm">
                <div className="w-10 h-10 rounded-lg bg-violet-50 flex items-center justify-center mx-auto mb-3">
                  <Bot size={20} className="text-violet-500" />
                </div>
                <p className="text-sm font-medium text-gray-900 mb-1">AI CRM Assistant</p>
                <p className="text-xs text-gray-400 mb-4">Create a new chat to start a conversation</p>
                <button
                  onClick={() => createConvMutation.mutate()}
                  className="text-xs bg-gray-900 text-white px-4 py-1.5 rounded hover:bg-gray-800"
                >
                  + New Chat
                </button>
              </div>
            </div>
          ) : allMessages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-xs">
                <p className="text-xs text-gray-400 mb-3">Type a message to start</p>
                <div className="text-[11px] text-gray-400 space-y-1.5 text-left">
                  {['Add contact John, phone 919876543210', 'Show all leads', 'What are the analytics?', 'Create a task to follow up tomorrow'].map((ex) => (
                    <button key={ex} onClick={() => setInput(ex)} className="block w-full text-left px-2.5 py-1.5 rounded border border-gray-100 hover:border-violet-200 hover:bg-violet-50/50 transition-colors">
                      &ldquo;{ex}&rdquo;
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              {allMessages.map((msg, i) => (
                <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className="flex items-start gap-2 max-w-lg">
                    {msg.role === 'assistant' && (
                      <div className="w-5 h-5 rounded bg-violet-100 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot size={11} className="text-violet-500" />
                      </div>
                    )}
                    <div className={cn('px-3 py-2 rounded-lg text-xs leading-relaxed', msg.role === 'user' ? 'bg-gray-900 text-white' : 'bg-white text-gray-800 border border-gray-150 shadow-sm')}>
                      {msg.toolCalls && msg.toolCalls.length > 0 && (
                        <div className="mb-1.5 space-y-1">
                          {msg.toolCalls.map((a, ai) => (
                            <div key={ai} className="flex items-start gap-1 text-[10px] bg-violet-50 text-violet-700 rounded px-2 py-1 border border-violet-100">
                              <Wrench size={9} className="mt-0.5 shrink-0" />
                              <span><strong>{a.tool}</strong> {a.result}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="mb-1.5 flex flex-wrap gap-1.5">
                          {msg.attachments.map((att, ai) => (
                            <span
                              key={ai}
                              className={cn(
                                'inline-flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5 border',
                                msg.role === 'user'
                                  ? 'bg-white/10 border-white/20 text-white'
                                  : 'bg-violet-50 border-violet-100 text-violet-700',
                              )}
                              title={`${att.fileName} (${att.size} bytes)`}
                            >
                              {att.kind === 'image' ? <ImageIcon size={9} /> : <FileText size={9} />}
                              {att.fileName}
                            </span>
                          ))}
                        </div>
                      )}
                      {msg.content && <p className="whitespace-pre-wrap">{(msg.content || '').replace(/\\n/g, '\n')}</p>}
                    </div>
                    {msg.role === 'user' && (
                      <div className="w-5 h-5 rounded bg-gray-200 flex items-center justify-center shrink-0 mt-0.5">
                        <User size={11} className="text-gray-500" />
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {chatMutation.isPending && (
                <div className="flex justify-start">
                  <div className="flex items-start gap-2">
                    <div className="w-5 h-5 rounded bg-violet-100 flex items-center justify-center shrink-0">
                      <Bot size={11} className="text-violet-500" />
                    </div>
                    <div className="bg-white text-gray-400 px-3 py-2 rounded-lg border border-gray-150 shadow-sm text-xs flex items-center gap-1.5">
                      <Loader2 size={11} className="animate-spin" /> Thinking...
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-gray-200 bg-white px-4 py-2.5 shrink-0">
          {/* Attachment previews */}
          {pendingAttachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {pendingAttachments.map((att, idx) => (
                <div
                  key={idx}
                  className="group relative flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded px-2 py-1 text-[10px] text-gray-700 max-w-[180px]"
                >
                  {att.kind === 'image' && att.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={att.previewUrl} alt={att.fileName} className="w-6 h-6 object-cover rounded shrink-0" />
                  ) : (
                    <FileText size={11} className="text-violet-500 shrink-0" />
                  )}
                  <span className="truncate flex-1">{att.fileName}</span>
                  <button
                    onClick={() => removeAttachment(idx)}
                    className="text-gray-400 hover:text-red-500 shrink-0"
                    title="Remove"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,text/*,.md,.json,.csv,.tsv,.yaml,.yml,.toml,.ini,.env,.log,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.kt,.cs,.cpp,.c,.h,.hpp,.php,.swift,.scala,.sh,.bash,.zsh,.sql,.graphql,.gql,.proto,.html,.htm,.css,.scss,.sass,.less,.xml,.svg"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void addFiles(e.target.files);
                e.target.value = ''; // allow re-adding the same file
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!activeConvId || !config?.apiKeySet || pendingAttachments.length >= MAX_ATTACHMENTS}
              className="text-gray-400 hover:text-violet-500 disabled:opacity-30 disabled:cursor-not-allowed p-2 shrink-0"
              title={`Attach files (max ${MAX_ATTACHMENTS}, 5 MB each)`}
            >
              <Paperclip size={14} />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              onPaste={handlePaste}
              placeholder={activeConvId ? (config?.apiKeySet ? 'Ask AI anything... (paste or attach files)' : 'Configure AI in Settings first') : 'Create a new chat to start'}
              disabled={!activeConvId || !config?.apiKeySet}
              rows={1}
              className="flex-1 border border-gray-200 rounded-lg px-2.5 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-violet-400 max-h-24 disabled:bg-gray-50 disabled:text-gray-300 placeholder:text-gray-300"
            />
            <button
              onClick={handleSend}
              disabled={(!input.trim() && pendingAttachments.length === 0) || chatMutation.isPending || !activeConvId}
              className="bg-gray-900 hover:bg-gray-800 disabled:opacity-30 text-white rounded-lg p-2 transition shrink-0"
            >
              <Send size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
