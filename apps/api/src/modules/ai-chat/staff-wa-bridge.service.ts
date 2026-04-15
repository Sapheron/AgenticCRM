/**
 * StaffWaBridgeService — bridges WhatsApp self-messages to AiChatService.
 *
 * When a staff member sends a message to themselves on WhatsApp (their
 * connected number), monitor.ts publishes to the `staff.ai.request` Redis
 * channel. This service subscribes, runs AiChatService with the user's full
 * permissions, saves the exchange to ChatConversation/ChatMessage, and sends
 * the AI reply back to WhatsApp via `wa:outbound`.
 *
 * Each user gets one persistent ChatConversation per WhatsApp account, so
 * chat history is maintained across sessions and is visible in the dashboard.
 */
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import Redis from 'ioredis';
import { AiChatService } from './ai-chat.service';

const STAFF_AI_REQUEST_CHANNEL = 'staff.ai.request';
const WA_OUTBOUND_CHANNEL = 'wa:outbound';
const WA_TYPING_CHANNEL = 'wa:typing';
const redisUrl = (process.env.REDIS_URL || '').trim();

@Injectable()
export class StaffWaBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StaffWaBridgeService.name);
  private subscriber!: Redis;
  private publisher!: Redis;

  constructor(private readonly aiChat: AiChatService) {}

  onModuleInit() {
    this.subscriber = new Redis(redisUrl);
    this.publisher = new Redis(redisUrl);

    this.subscriber.subscribe(STAFF_AI_REQUEST_CHANNEL, (err) => {
      if (err) {
        this.logger.error('Failed to subscribe to staff.ai.request: ' + String(err));
        return;
      }
      this.logger.log('Staff WhatsApp AI bridge active');
    });

    this.subscriber.on('message', (_channel: string, raw: string) => {
      void this.handleRequest(raw);
    });
  }

  onModuleDestroy() {
    void this.subscriber?.quit();
    void this.publisher?.quit();
  }

  private async handleRequest(raw: string): Promise<void> {
    let payload: { companyId: string; userId: string; accountId: string; text: string; replyToPhone?: string; replyToJid?: string };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      this.logger.warn('Invalid staff.ai.request payload: ' + raw.slice(0, 100));
      return;
    }

    const { companyId, userId, accountId, text, replyToPhone, replyToJid } = payload;
    this.logger.log(`Staff AI chat: user=${userId} account=${accountId}${replyToPhone ? ` from=${replyToPhone}` : ''}`);

    try {
      // Resolve the actual sender's identity and permissions:
      // - If replyToPhone is set, an allowed number sent the message → look up user by phone
      // - Otherwise, it's a self-chat → use the account owner (userId)
      let resolvedUserId = userId;
      let userPerms: { permissions: string[]; role: string } | null = null;

      if (replyToPhone) {
        // Look up the staff member whose phone matches the sender
        const senderUser = await prisma.user.findFirst({
          where: { companyId, phoneNumber: replyToPhone, isActive: true },
          select: { id: true, permissions: true, role: true },
        });
        if (senderUser) {
          resolvedUserId = senderUser.id;
          userPerms = { permissions: senderUser.permissions, role: senderUser.role };
          this.logger.log(`Resolved sender ${replyToPhone} to user ${senderUser.id} (${senderUser.role})`);
        } else {
          // Phone not linked to any user — fall back to account owner
          this.logger.warn(`No user found for phone ${replyToPhone}, falling back to account owner ${userId}`);
        }
      }

      // If we didn't resolve via phone, load the account owner's permissions
      if (!userPerms) {
        const ownerUser = await prisma.user.findUnique({
          where: { id: resolvedUserId },
          select: { permissions: true, role: true },
        });
        if (!ownerUser) {
          this.logger.warn(`Staff AI chat: user ${resolvedUserId} not found`);
          return;
        }
        userPerms = { permissions: ownerUser.permissions, role: ownerUser.role };
      }

      // Find or create the persistent ChatConversation for THIS sender + account
      let conv = await prisma.chatConversation.findFirst({
        where: { companyId, userId: resolvedUserId, whatsappAccountId: accountId },
        orderBy: { updatedAt: 'desc' },
      });
      if (!conv) {
        // Use the sender's phone as the title (or the connected account's phone for self-chat)
        const waAccount = await prisma.whatsAppAccount.findUnique({
          where: { id: accountId },
          select: { phoneNumber: true },
        });
        const chatPhone = replyToPhone || waAccount?.phoneNumber || 'WhatsApp';
        conv = await prisma.chatConversation.create({
          data: {
            companyId,
            userId: resolvedUserId,
            whatsappAccountId: accountId,
            title: `WhatsApp · ${chatPhone}`,
          },
        });
        this.logger.log(`Created new WhatsApp ChatConversation ${conv.id} for ${chatPhone}`);
      }

      // Load recent history (last 30 messages = ~15 turns)
      const history = await prisma.chatMessage.findMany({
        where: { conversationId: conv.id },
        orderBy: { createdAt: 'asc' },
        take: 30,
        select: { role: true, content: true },
      });

      // Save user message to history before calling AI
      await prisma.chatMessage.create({
        data: { conversationId: conv.id, role: 'user', content: text },
      });
      // Touch the conversation updatedAt so it bubbles up in list
      await prisma.chatConversation.update({
        where: { id: conv.id },
        data: { updatedAt: new Date() },
      });

      // Build message array: history + new user message
      const userMessages = [
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: text },
      ];

      // Get account phone for reply + typing target before AI call
      const account = await prisma.whatsAppAccount.findUnique({
        where: { id: accountId },
        select: { phoneNumber: true },
      });
      if (!account) return;
      const replyTo = replyToPhone || account.phoneNumber;
      const replyJid = replyToJid; // LID JID for direct addressing

      // Show "typing…" on WhatsApp before AI processes
      await this.publisher.publish(
        WA_TYPING_CHANNEL,
        JSON.stringify({ accountId, toPhone: replyTo, toJid: replyJid, action: 'composing' }),
      ).catch(() => null);

      // Run AI with the resolved sender's permissions (same as dashboard chat)
      const result = await this.aiChat.chat(
        companyId,
        userMessages,
        conv.id,
        userPerms.permissions,
        userPerms.role,
      );

      // Save AI response to history
      await prisma.chatMessage.create({
        data: {
          conversationId: conv.id,
          role: 'assistant',
          content: result.content,
          provider: result.provider,
          model: result.model,
          latencyMs: result.latencyMs,
        },
      });

      // Clear typing indicator and send the reply
      await this.publisher.publish(
        WA_TYPING_CHANNEL,
        JSON.stringify({ accountId, toPhone: replyTo, toJid: replyJid, action: 'paused' }),
      ).catch(() => null);

      await this.publisher.publish(
        WA_OUTBOUND_CHANNEL,
        JSON.stringify({
          accountId,
          toPhone: replyTo,
          toJid: replyJid,
          text: result.content,
        }),
      );

      this.logger.log(`Staff AI reply sent for user=${resolvedUserId} (${result.latencyMs}ms via ${result.provider}/${result.model})`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Staff AI chat error for user=${userId}: ${msg}`);

      // Send error back to WhatsApp so the sender knows something went wrong
      try {
        const account = await prisma.whatsAppAccount.findUnique({
          where: { id: accountId },
          select: { phoneNumber: true },
        });
        if (account) {
          const replyTo = replyToPhone || account.phoneNumber;
          // Clear typing indicator on error
          await this.publisher.publish(
            WA_TYPING_CHANNEL,
            JSON.stringify({ accountId, toPhone: replyTo, toJid: replyToJid, action: 'paused' }),
          ).catch(() => null);
          await this.publisher.publish(
            WA_OUTBOUND_CHANNEL,
            JSON.stringify({
              accountId,
              toPhone: replyTo,
              toJid: replyToJid,
              text: `⚠️ AI error: ${msg.slice(0, 200)}`,
            }),
          );
        }
      } catch { /* ignore send errors */ }
    }
  }
}
