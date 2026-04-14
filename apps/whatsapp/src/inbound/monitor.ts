/**
 * Inbound message monitor — hooks into Baileys sock.ev.on("messages.upsert").
 * Normalizes → deduplicates → stores → queues for AI processing.
 */
import type { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import { prisma } from '@wacrm/database';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { QUEUES } from '@wacrm/shared';
import { normalizeMessage } from './normalizer';
import { isAlreadyProcessed } from './dedup';
import { isRecentOutboundMessage } from './outbound-dedupe';
import { uploadMedia, mimeToExtension, ensureBucket } from '../media/media-storage';
import { noteInboundActivity } from '../session/session.manager';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const redisUrl = (process.env.REDIS_URL || '').trim();

const STAFF_AI_REQUEST_CHANNEL = 'staff.ai.request';

// Grace window for 'append' messages (matches OpenClaw's APPEND_RECENT_GRACE_MS).
// After reconnect, Baileys delivers offline messages as type='append'. We only
// process those within 60s of connection time — older ones are history catch-up
// that shouldn't trigger AI replies.
const APPEND_GRACE_MS = 60_000;

export class InboundMonitor {
  private readonly aiQueue: Queue;
  private readonly redis: Redis;
  private connectedAtMs = Date.now();

  constructor(
    private readonly sock: WASocket,
    private readonly accountId: string,
  ) {
    // No lazyConnect — connect immediately so publish() is always ready.
    // lazyConnect would silently drop publishes if connect() was never called.
    this.redis = new Redis(redisUrl);
    this.aiQueue = new Queue(QUEUES.AI_MESSAGE, { connection: new Redis(redisUrl) });
  }

  async init() {
    await ensureBucket().catch((err: unknown) => logger.warn({ err }, 'MinIO bucket init failed — media uploads disabled'));
  }

  start() {
    this.connectedAtMs = Date.now();

    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      for (const msg of messages) {
        // Track inbound activity for stale connection watchdog (OpenClaw pattern)
        noteInboundActivity(this.accountId);

        // Skip protocol-only messages (read receipts, key distribution, etc.)
        if (!msg.message) continue;

        // Staff self-chat: handle BEFORE the type filter because self-sent messages
        // can arrive as type='append' on some Baileys versions, not just 'notify'.
        if (msg.key?.fromMe === true && msg.key?.remoteJid) {
          await this.maybeHandleStaffChat(msg).catch((err: unknown) =>
            logger.warn({ err, accountId: this.accountId }, 'Staff chat handler failed'),
          );
          continue; // never treat our own messages as customer messages
        }

        // Accept both 'notify' (real-time) and 'append' (history sync, reconnect catch-up).
        if (type !== 'notify' && type !== 'append') continue;

        // For 'append' type: only process messages within the grace window.
        // Older messages are history sync — store but don't trigger AI replies.
        // Matches OpenClaw's APPEND_RECENT_GRACE_MS pattern.
        if (type === 'append') {
          const msgTs = msg.messageTimestamp;
          const msgTsMs = msgTs != null ? Number(msgTs) * 1000 : 0;
          if (msgTsMs < this.connectedAtMs - APPEND_GRACE_MS) {
            logger.debug({ accountId: this.accountId, msgTs }, 'Skipping old append message (outside grace window)');
            continue;
          }
        }

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

    // Look up the WhatsApp account to get companyId + allowlist
    const account = await prisma.whatsAppAccount.findUnique({
      where: { id: this.accountId },
      select: { companyId: true, id: true, userId: true, allowedNumbers: true },
    });
    if (!account) return;

    // Determine if this sender is in the allowlist.
    // Normalize both sides to digits-only. Also check suffix match to handle
    // cases where allowlist has "9876543210" but sender is "919876543210" (with country code).
    const digitsOnly = (p: string) => p.replace(/\D/g, '');
    const senderDigits = digitsOnly(normalized.fromPhone);
    const isAllowedNumber = account.allowedNumbers.length > 0
      && account.allowedNumbers.some((n) => {
        const allowed = digitsOnly(n);
        return allowed === senderDigits || senderDigits.endsWith(allowed) || allowed.endsWith(senderDigits);
      });

    // If allowlist is set and sender is NOT in it, skip entirely
    if (account.allowedNumbers.length > 0 && !isAllowedNumber) {
      logger.debug(
        { accountId: this.accountId, fromPhone: normalized.fromPhone },
        'Number not in allowlist, skipping',
      );
      return;
    }

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

    // Download media from WhatsApp and upload to MinIO (mirrors OpenClaw's downloadInboundMedia)
    let mediaUrl: string | undefined;
    if (normalized.mediaType && normalized.mediaData?.mimetype) {
      try {
        const buffer = await downloadMediaMessage(
          msg as WAMessage,
          'buffer',
          {},
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { reuploadRequest: this.sock.updateMediaMessage, logger: logger as any },
        );
        if (buffer && Buffer.isBuffer(buffer)) {
          const ext = mimeToExtension(normalized.mediaData.mimetype);
          mediaUrl = await uploadMedia(buffer, normalized.mediaData.mimetype, ext);
          logger.info({ mediaUrl, mediaType: normalized.mediaType }, 'Media downloaded and uploaded to MinIO');
        }
      } catch (err: unknown) {
        logger.warn({ err, mediaType: normalized.mediaType }, 'Failed to download/upload media — message stored without media');
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
        status: (conversation.status === 'RESOLVED' || conversation.status === 'HUMAN_HANDLING') ? 'OPEN' : conversation.status,
      },
    });

    logger.info(
      { companyId, conversationId: conversation.id, messageId: storedMessage.id },
      'Inbound message stored',
    );

    // Route AI processing based on whether sender is an allowed number
    // Resolve userId: use account.userId if set, otherwise find any admin in the company
    let staffUserId = account.userId;
    if (isAllowedNumber && !staffUserId) {
      const admin = await prisma.user.findFirst({
        where: { companyId, role: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true },
        select: { id: true },
      });
      staffUserId = admin?.id ?? null;
    }

    if (isAllowedNumber && staffUserId && normalized.body?.trim()) {
      // Allowed numbers get the full admin AI (same as staff self-chat):
      // routed through StaffWaBridgeService with full CRM tools + permissions.
      // This bypasses autoReplyEnabled since it's a staff control channel.
      await this.redis.publish(
        STAFF_AI_REQUEST_CHANNEL,
        JSON.stringify({
          companyId,
          userId: staffUserId,
          accountId: this.accountId,
          text: normalized.body.trim(),
          replyToPhone: normalized.fromPhone, // reply to the sender, not self
        }),
      );
      logger.info(
        { messageId: storedMessage.id, fromPhone: normalized.fromPhone },
        'Allowed number message routed to staff AI bridge',
      );
    } else {
      // Regular inbound: queue through worker agent-loop (respects autoReplyEnabled)
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

    // ── Lead + deal + task + campaign hooks (best-effort, never block ingestion) ────
    await this.maybeCreateLead(companyId, contact.id, normalized.body)
      .catch((err: unknown) => logger.warn({ err, contactId: contact.id }, 'lead auto-create failed'));
    await this.bumpLeadScore(companyId, contact.id)
      .catch((err: unknown) => logger.warn({ err, contactId: contact.id }, 'lead score bump failed'));
    await this.touchOpenDeals(companyId, contact.id)
      .catch((err: unknown) => logger.warn({ err, contactId: contact.id }, 'deal touch failed'));
    await this.touchOpenTasks(companyId, contact.id)
      .catch((err: unknown) => logger.warn({ err, contactId: contact.id }, 'task touch failed'));
    await this.markCampaignRecipientsReplied(companyId, contact.id)
      .catch((err: unknown) => logger.warn({ err, contactId: contact.id }, 'campaign reply hook failed'));
  }

  /**
   * For every active campaign where this contact is a SENT/DELIVERED/READ
   * recipient, advance their status to REPLIED and bump the campaign's
   * repliedCount. Idempotent per recipient — the DB rank check in
   * CampaignsService ensures we never downgrade a later state.
   *
   * Inlined here to avoid a cross-app import — mirrors the pattern used by
   * `touchOpenDeals` / `maybeCreateLead` above.
   */
  private async markCampaignRecipientsReplied(
    companyId: string,
    contactId: string,
  ): Promise<void> {
    const rows = await prisma.campaignRecipient.findMany({
      where: {
        companyId,
        contactId,
        status: { in: ['SENT', 'DELIVERED', 'READ'] },
        campaign: { status: { in: ['SENDING', 'COMPLETED'] } },
      },
      select: { id: true, campaignId: true },
    });
    if (!rows.length) return;

    const now = new Date();
    for (const r of rows) {
      await prisma.campaignRecipient.update({
        where: { id: r.id },
        data: { status: 'REPLIED', repliedAt: now },
      });
      await prisma.campaign.update({
        where: { id: r.campaignId },
        data: { repliedCount: { increment: 1 } },
      });
      await prisma.campaignActivity.create({
        data: {
          campaignId: r.campaignId,
          companyId,
          type: 'RECIPIENT_REPLIED',
          actorType: 'whatsapp',
          title: 'Recipient replied',
          metadata: { recipientId: r.id, contactId },
        },
      });
    }
    logger.info({ contactId, count: rows.length }, 'Marked campaign recipients as REPLIED');
  }

  /**
   * For every open task linked to this contact, drop a `CUSTOM` activity
   * row "Contact replied via WhatsApp". Doesn't change the task state —
   * just gives the timeline visibility into inbound messages on related tasks.
   */
  private async touchOpenTasks(companyId: string, contactId: string): Promise<void> {
    const open = await prisma.task.findMany({
      where: {
        companyId,
        contactId,
        status: { notIn: ['DONE', 'CANCELLED'] },
      },
      select: { id: true },
    });
    if (!open.length) return;

    for (const t of open) {
      await prisma.taskActivity.create({
        data: {
          taskId: t.id,
          companyId,
          type: 'CUSTOM',
          actorType: 'whatsapp',
          title: 'Contact replied via WhatsApp',
        },
      });
    }
  }

  /**
   * For every open deal on this contact, refresh `lastTouchedAt` and drop a
   * `RESPONDED` activity row so the deal timeline shows the inbound message.
   * Best-effort — silently no-ops if there are no open deals.
   */
  private async touchOpenDeals(companyId: string, contactId: string): Promise<void> {
    const open = await prisma.deal.findMany({
      where: {
        companyId,
        contactId,
        deletedAt: null,
        stage: { notIn: ['WON', 'LOST'] },
      },
      select: { id: true },
    });
    if (!open.length) return;

    const now = new Date();
    for (const d of open) {
      await prisma.deal.update({
        where: { id: d.id },
        data: { lastTouchedAt: now },
      });
      await prisma.dealActivity.create({
        data: {
          dealId: d.id,
          companyId,
          type: 'RESPONDED',
          actorType: 'whatsapp',
          title: 'Inbound WhatsApp message',
        },
      });
    }
  }

  /**
   * If this contact has zero open leads in the last 30 days, create one with
   * source=WHATSAPP. Skips silently if any open lead exists or on any error.
   */
  private async maybeCreateLead(companyId: string, contactId: string, body?: string): Promise<void> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const existing = await prisma.lead.findFirst({
      where: {
        companyId,
        contactId,
        deletedAt: null,
        status: { notIn: ['WON', 'LOST', 'DISQUALIFIED'] },
        createdAt: { gte: thirtyDaysAgo },
      },
      select: { id: true },
    });
    if (existing) return;

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { displayName: true, phoneNumber: true },
    });
    const title = `Inbound from ${contact?.displayName ?? contact?.phoneNumber ?? 'WhatsApp'}`;

    const lead = await prisma.lead.create({
      data: {
        companyId,
        contactId,
        title,
        status: 'NEW',
        source: 'WHATSAPP',
        priority: 'MEDIUM',
        score: 5,
        notes: body?.slice(0, 200),
      },
    });
    await prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        companyId,
        type: 'CREATED',
        actorType: 'whatsapp',
        title: 'Auto-created from inbound WhatsApp message',
        body: body?.slice(0, 500),
      },
    });
    logger.info({ leadId: lead.id, contactId }, 'Auto-created lead from inbound WhatsApp');
  }

  /**
   * Handles messages sent by the account owner to themselves (fromMe=true,
   * remoteJid === own number). These are treated as staff AI chat inputs — the
   * message is forwarded to the API via Redis so AiChatService processes it with
   * the full admin tool set and sends the reply back to WhatsApp.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async maybeHandleStaffChat(msg: any): Promise<void> {
    // Skip echoes of messages we sent (prevents infinite self-reply loops).
    // Mirrors OpenClaw's isRecentOutboundMessage dedup.
    const msgId = msg.key?.id as string | undefined;
    if (msgId && isRecentOutboundMessage(this.accountId, msg.key.remoteJid as string, msgId)) {
      logger.debug({ msgId, accountId: this.accountId }, 'Skipping outbound echo (self-reply prevention)');
      return;
    }

    const account = await prisma.whatsAppAccount.findUnique({
      where: { id: this.accountId },
      select: { companyId: true, userId: true, phoneNumber: true },
    });

    // Only staff-owned accounts (userId set)
    if (!account?.userId) return;

    // Only self-messages: compare digits-only on BOTH sides.
    // msg.key.remoteJid can be "91XXXXXXXXXX@s.whatsapp.net" or "91XXXXXXXXXX:62@s.whatsapp.net"
    // account.phoneNumber may be stored as "91XXXXXXXXXX" (digits only) or "+91XXXXXXXXXX"
    const ownPhone = (account.phoneNumber ?? '').replace(/\D/g, '');
    const remotePhone = (msg.key.remoteJid as string).split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!ownPhone || remotePhone !== ownPhone) return;

    // Unwrap container types using the same wrapper keys as normalizer.ts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let content: Record<string, any> = msg.message ?? {};
    const WRAPPER_KEYS = ['botInvokeMessage', 'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'groupMentionedMessage', 'editedMessage'];
    for (let depth = 0; depth < 4; depth++) {
      let unwrapped = false;
      for (const key of WRAPPER_KEYS) {
        if (content[key]?.message) { content = content[key].message as Record<string, unknown>; unwrapped = true; break; }
      }
      if (!unwrapped) break;
    }

    const text: string | undefined =
      (content.conversation as string | undefined) ??
      (content.extendedTextMessage as { text?: string } | undefined)?.text ??
      (content.imageMessage as { caption?: string } | undefined)?.caption ??
      (content.videoMessage as { caption?: string } | undefined)?.caption ??
      (content.documentMessage as { caption?: string } | undefined)?.caption;

    if (!text?.trim()) return;

    await this.redis.publish(
      STAFF_AI_REQUEST_CHANNEL,
      JSON.stringify({
        companyId: account.companyId,
        userId: account.userId,
        accountId: this.accountId,
        text: text.trim(),
      }),
    );
    logger.info({ userId: account.userId, accountId: this.accountId }, 'Staff WhatsApp AI chat message queued');
  }

  /**
   * Re-run the scoring rules for any open lead linked to this contact. Mirrors
   * the API's `LeadsService.recalculateScore` but inlined here so we don't
   * cross-import from apps/api.
   */
  private async bumpLeadScore(companyId: string, contactId: string): Promise<void> {
    const leads = await prisma.lead.findMany({
      where: {
        companyId,
        contactId,
        deletedAt: null,
        status: { notIn: ['WON', 'LOST', 'DISQUALIFIED'] },
      },
      select: {
        id: true,
        score: true,
        status: true,
        tags: true,
        estimatedValue: true,
        updatedAt: true,
      },
    });
    if (!leads.length) return;

    const recentMessages = await prisma.message.findMany({
      where: { companyId, conversation: { contactId } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { direction: true, createdAt: true },
    });

    for (const lead of leads) {
      const newScore = scoreLeadInline(lead, recentMessages);
      if (newScore === lead.score) continue;

      await prisma.lead.update({ where: { id: lead.id }, data: { score: newScore } });
      await prisma.leadScoreEvent.create({
        data: {
          leadId: lead.id,
          companyId,
          delta: newScore - lead.score,
          newScore,
          reason: 'inbound message',
          source: 'auto',
        },
      });
    }
  }
}

// ── Local scoring (mirrors apps/api/src/modules/leads/scoring.ts) ───────────
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function scoreLeadInline(
  lead: { score: number; status: string; tags: string[]; estimatedValue: number | null; updatedAt: Date },
  recentMessages: { direction: string; createdAt: Date }[],
): number {
  let total = 0;
  if (lead.score === 0) total += 5;

  const inbound = recentMessages.filter((m) => m.direction === 'INBOUND');
  const outbound = recentMessages.filter((m) => m.direction === 'OUTBOUND');
  if (inbound.length && outbound.length) {
    const lastIn = inbound[0]?.createdAt.getTime() ?? 0;
    const lastOut = outbound[0]?.createdAt.getTime() ?? 0;
    if (lastIn > lastOut) {
      total += 10;
      if (lastIn - lastOut <= HOUR) total += 5;
    }
  }
  const since = Date.now() - DAY;
  if (inbound.filter((m) => m.createdAt.getTime() >= since).length >= 3) total += 5;

  if ((lead.estimatedValue ?? 0) >= 50000) total += 10;
  if (lead.status === 'QUALIFIED') total += 20;
  else if (lead.status === 'PROPOSAL_SENT') total += 15;
  else if (lead.status === 'NEGOTIATING') total += 10;

  if (lead.tags.includes('high-intent')) total += 15;
  if (lead.tags.includes('cold')) total -= 10;

  const lastActivity = recentMessages[0]?.createdAt.getTime() ?? lead.updatedAt.getTime();
  if (Date.now() - lastActivity > 14 * DAY) total -= 5;

  return Math.max(0, Math.min(100, total));
}
