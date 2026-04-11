/**
 * Campaign Send processor — drains PENDING `CampaignRecipient` rows for
 * SENDING campaigns in DIRECT mode, rate-limited by each campaign's
 * configured throttle window.
 *
 * BROADCAST and SEQUENCE mode campaigns are NOT handled here:
 *   - BROADCAST mode reuses the existing broadcast pipeline and its own
 *     BroadcastRecipient rows. The campaign's recipients only serve as an
 *     audit record — the scheduler/launch hook is responsible for creating
 *     the Broadcast row itself. (Follow-up task.)
 *   - SEQUENCE mode enrols each recipient into the target Sequence via the
 *     existing sequence-execution loop.
 *
 * For DIRECT mode, this processor:
 *   1. Picks the next SENDING campaign with PENDING recipients
 *   2. Loads its template and throttle
 *   3. Drains a batch of recipients, rendering the template against each
 *      contact's displayName/phoneNumber/email/customFields
 *   4. Publishes each rendered message to the `wa:broadcast` Redis channel
 *      (same contract the broadcast worker uses — downstream WhatsApp
 *      subscriber handles the actual send)
 *   5. Advances recipient state to SENT and bumps campaign counters
 *   6. Re-checks the campaign status between every recipient so pause /
 *      cancel takes effect within one throttle window
 *   7. On final drain, transitions campaign → COMPLETED
 *
 * Pattern mirrors `broadcast.processor.ts` — same batch/throttle/pub-sub shape.
 */
import { Worker, type Job, Queue } from 'bullmq';
import pino from 'pino';
import Redis from 'ioredis';
import { prisma } from '@wacrm/database';
import { QUEUES, sleep } from '@wacrm/shared';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const redisUrl = (process.env.REDIS_URL || '').trim();
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const publisher = new Redis(redisUrl);

const BATCH_SIZE = 25;

export function campaignSendQueue(): Queue {
  return new Queue(QUEUES.CAMPAIGN_SEND, { connection });
}

export function startCampaignSendProcessor(): Worker {
  const worker = new Worker(
    QUEUES.CAMPAIGN_SEND,
    async (_job: Job) => {
      try {
        // Find at most one active DIRECT campaign with pending recipients.
        // Running one at a time matches the broadcast worker's concurrency=1
        // semantics — WhatsApp anti-spam doesn't tolerate parallel sends.
        const candidates = await prisma.campaign.findMany({
          where: {
            status: 'SENDING',
            sendMode: 'DIRECT',
          },
          select: {
            id: true,
            companyId: true,
            name: true,
            templateId: true,
            throttleMs: true,
          },
          take: 5,
          orderBy: { startedAt: 'asc' },
        });

        for (const campaign of candidates) {
          await drainCampaign(campaign);
        }
      } catch (err) {
        logger.error({ err }, 'Campaign send tick errored');
      }
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Campaign send job failed');
  });

  return worker;
}

async function drainCampaign(campaign: {
  id: string;
  companyId: string;
  name: string;
  templateId: string | null;
  throttleMs: number;
}): Promise<void> {
  if (!campaign.templateId) {
    logger.warn({ campaignId: campaign.id }, 'DIRECT campaign has no templateId — skipping');
    return;
  }

  const template = await prisma.template.findUnique({
    where: { id: campaign.templateId },
    select: { id: true, name: true, body: true, variables: true, status: true },
  });
  if (!template) {
    logger.warn({ campaignId: campaign.id, templateId: campaign.templateId }, 'Template not found — failing campaign');
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'FAILED', errorMessage: 'Template not found' },
    });
    await logActivity(campaign.id, campaign.companyId, 'ERROR', 'Template missing', {
      templateId: campaign.templateId,
    });
    return;
  }

  while (true) {
    // Re-check status at the top of every batch
    const fresh = await prisma.campaign.findUnique({
      where: { id: campaign.id },
      select: { status: true, throttleMs: true },
    });
    if (!fresh) return;
    if (fresh.status === 'PAUSED' || fresh.status === 'CANCELLED') {
      logger.info({ campaignId: campaign.id, status: fresh.status }, 'Stopping drain');
      return;
    }
    if (fresh.status !== 'SENDING') return;

    const batch = await prisma.campaignRecipient.findMany({
      where: { campaignId: campaign.id, status: 'PENDING' },
      take: BATCH_SIZE,
      orderBy: { queuedAt: 'asc' },
      include: {
        campaign: { select: { companyId: true } },
      },
    });
    if (batch.length === 0) break;

    for (const r of batch) {
      // Mid-batch status recheck
      const mid = await prisma.campaign.findUnique({
        where: { id: campaign.id },
        select: { status: true },
      });
      if (mid?.status === 'PAUSED' || mid?.status === 'CANCELLED') {
        logger.info({ campaignId: campaign.id, status: mid.status }, 'Aborting mid-batch');
        return;
      }

      // Load contact and render template
      const contact = await prisma.contact.findUnique({
        where: { id: r.contactId },
        select: {
          id: true,
          phoneNumber: true,
          displayName: true,
          firstName: true,
          lastName: true,
          email: true,
          customFields: true,
        },
      });
      if (!contact) {
        await prisma.campaignRecipient.update({
          where: { id: r.id },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            errorReason: 'contact not found',
          },
        });
        await bumpCounter(campaign.id, 'failedCount');
        continue;
      }

      const rendered = renderTemplate(template.body, contact);

      try {
        // Mark QUEUED so a crash leaves no ambiguous state.
        await prisma.campaignRecipient.update({
          where: { id: r.id },
          data: { status: 'QUEUED', renderedText: rendered },
        });

        // Publish on the SAME channel the broadcast worker uses — the
        // downstream wa:broadcast subscriber handles the actual send.
        await publisher.publish('wa:broadcast', JSON.stringify({
          companyId: campaign.companyId,
          contactId: contact.id,
          toPhone: contact.phoneNumber,
          text: rendered,
          mediaUrl: null,
        }));

        await prisma.campaignRecipient.update({
          where: { id: r.id },
          data: { status: 'SENT', sentAt: new Date() },
        });
        await bumpCounter(campaign.id, 'sentCount');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await prisma.campaignRecipient.update({
          where: { id: r.id },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            errorReason: msg.slice(0, 500),
          },
        });
        await bumpCounter(campaign.id, 'failedCount');
        logger.warn({ campaignId: campaign.id, recipientId: r.id, err: msg }, 'Send failed');
      }

      // Throttle + jitter
      const throttle = (fresh.throttleMs ?? 2000) + Math.floor(Math.random() * 500);
      await sleep(throttle);
    }
  }

  // Auto-complete when no pending / queued remain
  const remaining = await prisma.campaignRecipient.count({
    where: {
      campaignId: campaign.id,
      status: { in: ['PENDING', 'QUEUED'] },
    },
  });
  if (remaining === 0) {
    const finalCheck = await prisma.campaign.findUnique({
      where: { id: campaign.id },
      select: { status: true, sentCount: true, failedCount: true },
    });
    if (finalCheck?.status === 'SENDING') {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      await logActivity(campaign.id, campaign.companyId, 'COMPLETED', `Sent ${finalCheck.sentCount}, failed ${finalCheck.failedCount}`, {
        sentCount: finalCheck.sentCount,
        failedCount: finalCheck.failedCount,
      });
      logger.info({ campaignId: campaign.id }, 'Campaign completed');
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function bumpCounter(
  campaignId: string,
  field: 'sentCount' | 'failedCount' | 'deliveredCount' | 'readCount' | 'repliedCount',
): Promise<void> {
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { [field]: { increment: 1 } },
  });
}

async function logActivity(
  campaignId: string,
  companyId: string,
  type: 'ERROR' | 'COMPLETED' | 'PAUSED' | 'RESUMED',
  title: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await prisma.campaignActivity.create({
      data: {
        campaignId,
        companyId,
        type,
        actorType: 'worker',
        title,
        metadata: metadata as never,
      },
    });
  } catch (err) {
    logger.warn({ err, campaignId }, 'Failed to log campaign activity');
  }
}

/**
 * Render `{{var}}` tokens in a template body against a contact's fields.
 * Supports `firstName`, `lastName`, `displayName`, `phoneNumber`, `email`,
 * and anything under `customFields`. Unknown vars are left as-is.
 */
function renderTemplate(
  body: string,
  contact: {
    phoneNumber: string;
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    customFields: unknown;
  },
): string {
  const custom = (contact.customFields ?? {}) as Record<string, unknown>;
  const vars: Record<string, string | undefined> = {
    firstName: contact.firstName ?? undefined,
    lastName: contact.lastName ?? undefined,
    displayName: contact.displayName ?? contact.firstName ?? contact.phoneNumber,
    phoneNumber: contact.phoneNumber,
    email: contact.email ?? undefined,
    name: contact.displayName ?? contact.firstName ?? contact.phoneNumber,
    ...Object.fromEntries(
      Object.entries(custom).map(([k, v]) => [k, v === null || v === undefined ? undefined : String(v)]),
    ),
  };
  return body.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name: string) => {
    const v = vars[name];
    if (v === undefined || v === null) return match;
    return String(v);
  });
}
