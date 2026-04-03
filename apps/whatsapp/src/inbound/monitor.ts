/**
 * Inbound message monitor — hooks into Baileys sock.ev.on("messages.upsert").
 * Normalizes → deduplicates → stores → queues for AI processing.
 */
import type { WASocket } from '@whiskeysockets/baileys';
import pino from 'pino';
import { prisma } from '@wacrm/database';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { QUEUES } from '@wacrm/shared';
import { normalizeMessage } from './normalizer';
import { isAlreadyProcessed } from './dedup';
import { uploadMedia, mimeToExtension, ensureBucket } from '../media/media-storage';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const redisUrl = (process.env.REDIS_URL || '').trim();

export class InboundMonitor {
  private readonly aiQueue: Queue;
  private readonly redis: Redis;

  constructor(
    private readonly sock: WASocket,
    private readonly accountId: string,
  ) {
    this.redis = new Redis(redisUrl, { lazyConnect: true });
    this.aiQueue = new Queue(QUEUES.AI_MESSAGE, { connection: this.redis });
  }

  async init() {
    await ensureBucket().catch((err: unknown) => logger.warn({ err }, 'MinIO bucket init failed — media uploads disabled'));
  }

  start() {
    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        await this.handleMessage(msg).catch((err: unknown) => {
          logger.error({ accountId: this.accountId, err }, 'Error handling inbound message');
        });
      }
    });

    logger.info({ accountId: this.accountId }, 'Inbound monitor started');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleMessage(msg: any) {
    const normalized = normalizeMessage(msg as Parameters<typeof normalizeMessage>[0]);
    if (!normalized) return;

    // Dedup check
    if (await isAlreadyProcessed(normalized.whatsappMessageId)) {
      logger.debug({ id: normalized.whatsappMessageId }, 'Duplicate message, skipping');
      return;
    }

    // Look up the WhatsApp account to get companyId
    const account = await prisma.whatsAppAccount.findUnique({
      where: { id: this.accountId },
      select: { companyId: true, id: true },
    });
    if (!account) return;

    const { companyId } = account;

    // Find or create contact
    let contact = await prisma.contact.findFirst({
      where: { companyId, phoneNumber: normalized.fromPhone },
    });

    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          companyId,
          phoneNumber: normalized.fromPhone,
          displayName: normalized.displayName,
        },
      });
    } else if (normalized.displayName && !contact.displayName) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { displayName: normalized.displayName, lastSeenAt: new Date() },
      });
    }

    // Find or create conversation
    let conversation = await prisma.conversation.findFirst({
      where: {
        companyId,
        contactId: contact.id,
        whatsappAccountId: this.accountId,
        status: { notIn: ['CLOSED', 'SPAM'] },
      },
    });

    let _isNewConversation = false;
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          companyId,
          contactId: contact.id,
          whatsappAccountId: this.accountId,
          status: 'OPEN',
        },
      });
      _isNewConversation = true;
    }

    // Upload media to MinIO if present
    let mediaUrl: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (normalized.mediaData && (normalized.mediaData as any).buffer && normalized.mediaData.mimetype) {
      try {
        const ext = mimeToExtension(normalized.mediaData.mimetype);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mediaUrl = await uploadMedia((normalized.mediaData as any).buffer, normalized.mediaData.mimetype, ext);
        logger.info({ mediaUrl }, 'Media uploaded to MinIO');
      } catch (err: unknown) {
        logger.error({ err }, 'Failed to upload media to MinIO');
      }
    }

    // Store the message
    const messageType = normalized.mediaType?.toUpperCase() ?? 'TEXT';
    const storedMessage = await prisma.message.create({
      data: {
        companyId,
        conversationId: conversation.id,
        whatsappAccountId: this.accountId,
        whatsappMessageId: normalized.whatsappMessageId,
        direction: 'INBOUND',
        type: messageType as 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'STICKER' | 'LOCATION',
        status: 'DELIVERED',
        body: normalized.body,
        mediaUrl,
        mediaType: normalized.mediaData?.mimetype,
        mediaCaption: normalized.mediaData?.caption,
        latitude: normalized.location?.latitude,
        longitude: normalized.location?.longitude,
        sentAt: new Date(normalized.timestampMs),
      },
    });

    // Update conversation preview
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(normalized.timestampMs),
        lastMessageText: normalized.body?.slice(0, 200),
        unreadCount: { increment: 1 },
        status: conversation.status === 'RESOLVED' ? 'OPEN' : conversation.status,
      },
    });

    logger.info(
      { companyId, conversationId: conversation.id, messageId: storedMessage.id },
      'Inbound message stored',
    );

    // Queue for AI processing if AI is enabled on this conversation
    const freshConv = await prisma.conversation.findUnique({
      where: { id: conversation.id },
      select: { aiEnabled: true, status: true },
    });

    if (freshConv?.aiEnabled && freshConv.status !== 'HUMAN_HANDLING') {
      await this.aiQueue.add(
        'process-message',
        {
          companyId,
          conversationId: conversation.id,
          messageId: storedMessage.id,
          contactId: contact.id,
          accountId: this.accountId,
        },
        {
          jobId: `ai-${storedMessage.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );
      logger.info({ messageId: storedMessage.id }, 'Message queued for AI processing');
    }
  }
}
