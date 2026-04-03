/**
 * Subscribes to the Redis `wa:outbound` channel published by:
 *  - worker/agent-loop.ts (AI replies)
 *  - api/messages.controller.ts (manual agent replies)
 *  - worker/broadcast.processor.ts (broadcasts)
 *
 * Calls sendTextMessage / sendMediaMessage and updates the message status.
 */
import Redis from 'ioredis';
import pino from 'pino';
import { prisma } from '@wacrm/database';
import { sendTextMessage, sendMediaMessage } from './sender';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const redisUrl = process.env.REDIS_URL!;
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

interface OutboundPayload {
  accountId: string;
  contactId?: string;
  toPhone: string;
  messageId?: string;   // DB message ID (for status update)
  text?: string;
  mediaUrl?: string;
  mimeType?: string;
  caption?: string;
}

interface BroadcastPayload {
  companyId: string;
  contactId: string;
  toPhone: string;
  text: string;
  mediaUrl?: string;
}

export function startOutboundSubscriber(): void {
  const subscriber = new Redis(redisUrl);

  subscriber.subscribe('wa:outbound', 'wa:broadcast', (err) => {
    if (err) {
      logger.error({ err }, 'Failed to subscribe to outbound channels');
      return;
    }
    logger.info('Outbound subscriber started');
  });

  subscriber.on('message', (channel: string, raw: string) => {
    void handleOutbound(channel, raw);
  });
}

async function handleOutbound(channel: string, raw: string): Promise<void> {
  try {
    const payload = JSON.parse(raw) as OutboundPayload | BroadcastPayload;

    const accountId = (payload as OutboundPayload).accountId;
    const toPhone = payload.toPhone;

    if (!accountId || !toPhone) {
      // For broadcasts without accountId, look up active account for the company
      if ((payload as BroadcastPayload).companyId) {
        const account = await prisma.whatsAppAccount.findFirst({
          where: { companyId: (payload as BroadcastPayload).companyId, status: 'CONNECTED' },
          select: { id: true },
        });
        if (!account) {
          logger.warn({ payload }, 'No connected WA account for broadcast, skipping');
          return;
        }
        await sendText(account.id, toPhone, (payload as BroadcastPayload).text);
      }
      return;
    }

    const p = payload as OutboundPayload;

    // Send via Baileys
    let result: { success: boolean; waMessageId?: string; error?: string };

    if (p.mediaUrl && p.mimeType) {
      result = await sendMediaMessage(accountId, toPhone, p.mediaUrl, p.mimeType, p.caption);
    } else if (p.text) {
      result = await sendTextMessage(accountId, toPhone, p.text);
    } else {
      logger.warn({ channel, payload }, 'Outbound payload has neither text nor media, skipping');
      return;
    }

    // Update message status in DB
    if (p.messageId) {
      await prisma.message.update({
        where: { id: p.messageId },
        data: {
          status: result.success ? 'SENT' : 'FAILED',
          whatsappMessageId: result.waMessageId,
          sentAt: result.success ? new Date() : undefined,
          failedAt: result.success ? undefined : new Date(),
          errorMessage: result.error,
        },
      });
    }

    if (!result.success) {
      logger.error({ accountId, toPhone, error: result.error }, 'Failed to send outbound message');
    }
  } catch (err: unknown) {
    logger.error({ channel, err }, 'Error handling outbound message');
  }
}

async function sendText(accountId: string, toPhone: string, text: string): Promise<void> {
  const result = await sendTextMessage(accountId, toPhone, text);
  if (!result.success) {
    logger.error({ accountId, toPhone, error: result.error }, 'Broadcast send failed');
  }
}
