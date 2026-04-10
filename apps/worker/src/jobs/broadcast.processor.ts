/**
 * Broadcast worker — pulls QUEUED `BroadcastRecipient` rows in batches and
 * publishes each one to the Redis `wa:broadcast` channel.
 *
 * This is a rewrite of the original loop-over-contacts implementation. The
 * **`wa:broadcast` payload contract is preserved exactly** so the downstream
 * WhatsApp send subscriber doesn't need any changes:
 *
 *   { companyId, contactId, toPhone, text, mediaUrl }
 *
 * What's new:
 *   - Per-recipient row in DB → can pause / resume / cancel mid-flight,
 *     retry just the failed ones, and report exact delivery status
 *   - Re-checks broadcast.status between every message so PAUSED / CANCELLED
 *     takes effect within one throttle window
 *   - Per-recipient errorMessage capture
 *   - Aggregate counters on `Broadcast` are kept in sync per message
 *
 * Concurrency stays at 1: WhatsApp anti-spam doesn't tolerate parallelism.
 */
import { Worker, type Job, Queue } from 'bullmq';
import pino from 'pino';
import Redis from 'ioredis';
import { QUEUES } from '@wacrm/shared';
import { prisma } from '@wacrm/database';
import type { Prisma } from '@wacrm/database';
import { sleep } from '@wacrm/shared';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const redisUrl = (process.env.REDIS_URL || '').trim();
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

// Shared publisher connection — kept open for the lifetime of the worker
// rather than spawning a new Redis client per message like the old version.
const publisher = new Redis(redisUrl);

const BATCH_SIZE = 25;

async function logActivity(
  broadcastId: string,
  companyId: string,
  type: string,
  title: string,
  metadata: Record<string, unknown> = {},
) {
  try {
    await prisma.broadcastActivity.create({
      data: {
        broadcastId,
        companyId,
        type: type as never,
        actorType: 'worker',
        title,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    logger.warn({ err, broadcastId }, 'Failed to log broadcast activity');
  }
}

async function processBroadcast(broadcastId: string) {
  const broadcast = await prisma.broadcast.findUnique({ where: { id: broadcastId } });
  if (!broadcast) {
    logger.warn({ broadcastId }, 'Broadcast not found');
    return;
  }

  if (broadcast.status !== 'SCHEDULED' && broadcast.status !== 'SENDING') {
    logger.info({ broadcastId, status: broadcast.status }, 'Skipping — not in a sendable state');
    return;
  }

  // Promote to SENDING + log STARTED
  if (broadcast.status === 'SCHEDULED') {
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: 'SENDING', startedAt: new Date() },
    });
    await logActivity(broadcastId, broadcast.companyId, 'STARTED', 'Send started');
  }

  let totalSent = broadcast.sentCount;
  let totalFailed = broadcast.failedCount;

  // Loop until no more QUEUED recipients (or paused/cancelled)
  while (true) {
    // Re-check broadcast status before each batch
    const fresh = await prisma.broadcast.findUnique({
      where: { id: broadcastId },
      select: { status: true, throttleMs: true },
    });
    if (!fresh) break;
    if (fresh.status === 'PAUSED') {
      logger.info({ broadcastId }, 'Paused — exiting');
      return;
    }
    if (fresh.status === 'CANCELLED') {
      logger.info({ broadcastId }, 'Cancelled — exiting');
      return;
    }

    const batch = await prisma.broadcastRecipient.findMany({
      where: { broadcastId, status: 'QUEUED' },
      take: BATCH_SIZE,
      orderBy: { queuedAt: 'asc' },
    });
    if (batch.length === 0) break;

    for (const r of batch) {
      // Re-check status mid-batch (so pause takes effect within one message)
      const mid = await prisma.broadcast.findUnique({
        where: { id: broadcastId },
        select: { status: true },
      });
      if (mid?.status === 'PAUSED' || mid?.status === 'CANCELLED') {
        logger.info({ broadcastId, status: mid.status }, 'Aborting mid-batch');
        return;
      }

      try {
        // Mark SENDING before the publish so a worker crash leaves no
        // ambiguous state — these get cleaned up by retry_failed_recipients.
        await prisma.broadcastRecipient.update({
          where: { id: r.id },
          data: { status: 'SENDING' },
        });

        // ── PROTECTED CONTRACT — DO NOT CHANGE ─────────────────────────────
        // The wa:broadcast channel + payload shape is consumed by the
        // downstream WhatsApp send subscriber. Any change here breaks
        // existing deployments.
        await publisher.publish('wa:broadcast', JSON.stringify({
          companyId: broadcast.companyId,
          contactId: r.contactId,
          toPhone: r.toPhone,
          text: r.renderedText,
          mediaUrl: r.mediaUrl ?? broadcast.mediaUrl,
        }));
        // ───────────────────────────────────────────────────────────────────

        await prisma.broadcastRecipient.update({
          where: { id: r.id },
          data: { status: 'SENT', sentAt: new Date() },
        });
        totalSent++;
        await prisma.broadcast.update({
          where: { id: broadcastId },
          data: { sentCount: { increment: 1 } },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        await prisma.broadcastRecipient.update({
          where: { id: r.id },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            errorMessage: message.slice(0, 500),
          },
        });
        totalFailed++;
        await prisma.broadcast.update({
          where: { id: broadcastId },
          data: { failedCount: { increment: 1 } },
        });
        logger.warn({ broadcastId, recipientId: r.id, err: message }, 'Recipient send failed');
      }

      // Throttle: configured per broadcast, default 2000ms + jitter
      const throttle = (fresh.throttleMs ?? 2000) + Math.floor(Math.random() * 500);
      await sleep(throttle);
    }
  }

  // Final state — only mark COMPLETED if no PAUSED/CANCELLED happened
  const finalCheck = await prisma.broadcast.findUnique({
    where: { id: broadcastId },
    select: { status: true },
  });
  if (finalCheck?.status === 'SENDING') {
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await logActivity(broadcastId, broadcast.companyId, 'COMPLETED', `Sent ${totalSent}, failed ${totalFailed}`, {
      sentCount: totalSent,
      failedCount: totalFailed,
    });
    logger.info({ broadcastId, totalSent, totalFailed }, 'Broadcast completed');
  }
}

export function startBroadcastWorker() {
  const worker = new Worker(
    QUEUES.BROADCAST,
    async (job: Job) => {
      const { broadcastId } = job.data as { broadcastId: string; companyId: string };
      await processBroadcast(broadcastId);
    },
    { connection, concurrency: 1 }, // broadcasts run one at a time — WhatsApp anti-spam
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Broadcast job failed');
  });

  return worker;
}

/**
 * Dispatcher — called from `reminder.processor.ts` every minute. Scans for
 * SCHEDULED broadcasts whose `scheduledAt` has elapsed and enqueues them
 * onto the broadcast queue. We use a DB scan rather than BullMQ delayed
 * jobs so scheduling survives worker restarts (the DB is the source of truth).
 */
export async function dispatchDueScheduledBroadcasts(broadcastQueue: Queue) {
  const due = await prisma.broadcast.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledAt: { lte: new Date() },
    },
    select: { id: true, companyId: true },
    take: 100,
  });
  for (const b of due) {
    await broadcastQueue.add(
      'send-broadcast',
      { broadcastId: b.id, companyId: b.companyId },
      { jobId: `broadcast-${b.id}-${Date.now()}` },
    );
    logger.info({ broadcastId: b.id }, 'Dispatched scheduled broadcast');
  }
  return due.length;
}
