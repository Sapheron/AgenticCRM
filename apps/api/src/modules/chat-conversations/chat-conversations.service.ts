import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import { MemoryService } from '../memory/memory.service';

@Injectable()
export class ChatConversationsService {
  constructor(private readonly memory: MemoryService) {}

  async list(companyId: string, userId: string) {
    return prisma.chatConversation.findMany({
      where: { companyId, userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, updatedAt: true },
      take: 50,
    });
  }

  async get(companyId: string, userId: string, id: string) {
    const conv = await prisma.chatConversation.findFirst({
      where: { id, companyId, userId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    return conv;
  }

  async create(companyId: string, userId: string) {
    // Dedupe: if this user already has a pristine, empty "New Chat" with no
    // messages yet, reuse it instead of creating another one. This prevents
    // the sidebar from filling up with blank "New Chat" entries when the user
    // rapid-clicks the button.
    const existingEmpty = await prisma.chatConversation.findFirst({
      where: {
        companyId,
        userId,
        messageCount: 0,
        title: 'New Chat',
        whatsappAccountId: null,
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (existingEmpty) return existingEmpty;

    return prisma.chatConversation.create({
      data: { companyId, userId, title: 'New Chat' },
    });
  }

  /**
   * Persist the conversation as a markdown transcript in memory so it can be
   * recalled later. Mirrors OpenClaw's session-memory hook: dump the last ~15
   * turns to `memory/YYYY-MM-DD-{slug}.md` and re-index it.
   */
  async saveSessionToMemory(companyId: string, conversationId: string): Promise<void> {
    const conv = await prisma.chatConversation.findUnique({
      where: { id: conversationId },
      select: { title: true, createdAt: true },
    });
    if (!conv) return;

    const messages = await prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true, createdAt: true },
    });
    if (messages.length < 2) return; // not worth saving

    const transcript = messages
      .slice(-30) // keep last 30 messages, ~15 user/assistant pairs
      .map((m) => `**${m.role}** _(${m.createdAt.toISOString()})_:\n\n${m.content}`)
      .join('\n\n---\n\n');

    const slug = slugify(conv.title) || 'chat';
    const date = new Date().toISOString().slice(0, 10);
    const path = `memory/${date}-${slug}.md`;
    const body = `# ${conv.title}\n\n_Saved ${date}, ${messages.length} messages_\n\n${transcript}\n`;

    try {
      await this.memory.writeFile(companyId, path, body, 'session');
    } catch (err) {
      console.warn('[ChatConv] saveSessionToMemory failed:', err instanceof Error ? err.message : err);
    }
  }

  async updateTitle(companyId: string, userId: string, id: string, title: string) {
    await this.get(companyId, userId, id);
    return prisma.chatConversation.update({
      where: { id },
      data: { title },
    });
  }

  async delete(companyId: string, userId: string, id: string) {
    await this.get(companyId, userId, id);
    // Save the transcript to memory before deleting so it survives as a recall
    // target. Failure here is non-fatal — proceed with delete regardless.
    await this.saveSessionToMemory(companyId, id);
    return prisma.chatConversation.delete({ where: { id } });
  }

  async getMessages(conversationId: string) {
    return prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, role: true, content: true, toolCalls: true, attachments: true,
        provider: true, model: true, latencyMs: true, createdAt: true,
      },
    });
  }

  async addMessage(conversationId: string, data: {
    role: string; content: string; toolCalls?: unknown; attachments?: unknown;
    provider?: string; model?: string; latencyMs?: number;
  }) {
    // Strip raw base64 from attachments before persisting — we keep just the
    // metadata + (for text files) the decoded content. Image bytes are too
    // heavy for the chat history table and we already passed them to the model.
    const persistedAttachments = stripAttachmentBytes(data.attachments);

    const msg = await prisma.chatMessage.create({
      data: {
        conversationId,
        role: data.role,
        content: data.content,
        toolCalls: data.toolCalls as any ?? undefined,
        attachments: persistedAttachments as any ?? undefined,
        provider: data.provider,
        model: data.model,
        latencyMs: data.latencyMs,
      },
    });

    // Auto-generate title from first user message
    const conv = await prisma.chatConversation.findUnique({
      where: { id: conversationId },
      select: { title: true },
    });
    if (conv?.title === 'New Chat' && data.role === 'user') {
      const autoTitle = data.content.slice(0, 50) + (data.content.length > 50 ? '...' : '');
      await prisma.chatConversation.update({
        where: { id: conversationId },
        data: { title: autoTitle },
      });
    }

    // Touch conversation updatedAt + bump the message counter so dedupe logic
    // knows this conversation is no longer pristine.
    await prisma.chatConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date(), messageCount: { increment: 1 } },
    });

    return msg;
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Drop raw base64 bytes from attachments before saving them to the chat
 * history table. We retain metadata (kind, mimeType, fileName, size) so the
 * UI can render an attachment chip, plus the decoded text for text/code
 * files (which we want to preserve for transcript replay).
 */
function stripAttachmentBytes(attachments: unknown): unknown {
  if (!Array.isArray(attachments)) return undefined;
  return attachments.map((a) => {
    if (!a || typeof a !== 'object') return a;
    const att = a as Record<string, unknown>;
    return {
      kind: att.kind,
      mimeType: att.mimeType,
      fileName: att.fileName,
      size: att.size,
      // text files: keep the decoded content; images: drop the base64 payload
      ...(att.kind === 'text' && typeof att.text === 'string' ? { text: att.text } : {}),
    };
  });
}
