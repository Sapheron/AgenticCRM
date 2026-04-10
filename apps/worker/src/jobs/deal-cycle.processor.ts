/**
 * Deal Cycle processor — runs daily at 04:00.
 *
 * Three housekeeping passes for open deals:
 *   1. Backfill `salesCycleDays` for any closed deal that doesn't have it
 *      yet (mostly historical data).
 *   2. Flag deals whose `expectedCloseAt` is in the past and stage is still
 *      open — drop a `FIELD_UPDATED` activity so the timeline shows the slip.
 *   3. Flag deals with no activity in the last 14 days as "stalled" via a
 *      `CUSTOM` activity row.
 *
 * Self-contained — no cross-app imports. Mirrors `lead-decay.processor.ts`.
 */
import { Worker, Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { prisma } from '@wacrm/database';
import { QUEUES } from '@wacrm/shared';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

const DAY = 24 * 60 * 60 * 1000;
const STALL_THRESHOLD_DAYS = 14;
const BATCH_SIZE = 200;

async function runDealCycle(): Promise<{ scanned: number; backfilled: number; overdue: number; stalled: number }> {
  const now = new Date();
  const result = { scanned: 0, backfilled: 0, overdue: 0, stalled: 0 };

  // 1. Backfill salesCycleDays for closed deals missing it
  const missingCycle = await prisma.deal.findMany({
    where: {
      deletedAt: null,
      stage: { in: ['WON', 'LOST'] },
      salesCycleDays: null,
    },
    take: BATCH_SIZE,
    select: { id: true, createdAt: true, wonAt: true, lostAt: true },
  });
  for (const d of missingCycle) {
    const closedAt = (d.wonAt ?? d.lostAt ?? now).getTime();
    const days = Math.max(0, Math.round((closedAt - d.createdAt.getTime()) / DAY));
    await prisma.deal.update({ where: { id: d.id }, data: { salesCycleDays: days } });
    result.backfilled++;
  }

  // 2. Overdue close dates (open deals with expectedCloseAt in the past)
  const overdue = await prisma.deal.findMany({
    where: {
      deletedAt: null,
      stage: { notIn: ['WON', 'LOST'] },
      expectedCloseAt: { lt: now },
    },
    take: BATCH_SIZE,
    select: { id: true, companyId: true, expectedCloseAt: true, title: true },
  });
  for (const d of overdue) {
    // Skip if we already logged this in the past 24h to avoid spam
    const recent = await prisma.dealActivity.findFirst({
      where: {
        dealId: d.id,
        type: 'FIELD_UPDATED',
        title: { contains: 'overdue close date' },
        createdAt: { gte: new Date(now.getTime() - DAY) },
      },
      select: { id: true },
    });
    if (recent) continue;

    await prisma.dealActivity.create({
      data: {
        dealId: d.id,
        companyId: d.companyId,
        type: 'FIELD_UPDATED',
        actorType: 'system',
        title: `overdue close date — was ${d.expectedCloseAt?.toISOString().slice(0, 10)}`,
        body: `"${d.title}" expected to close ${d.expectedCloseAt?.toISOString().slice(0, 10)} but is still open`,
      },
    });
    result.overdue++;
  }

  // 3. Stalled deals (no activity in 14 days)
  const cutoff = new Date(now.getTime() - STALL_THRESHOLD_DAYS * DAY);
  const stalled = await prisma.deal.findMany({
    where: {
      deletedAt: null,
      stage: { notIn: ['WON', 'LOST'] },
      updatedAt: { lt: cutoff },
    },
    take: BATCH_SIZE,
    select: { id: true, companyId: true, title: true },
  });
  for (const d of stalled) {
    const recent = await prisma.dealActivity.findFirst({
      where: {
        dealId: d.id,
        type: 'CUSTOM',
        title: { contains: 'stalled' },
        createdAt: { gte: new Date(now.getTime() - 7 * DAY) }, // weekly cadence
      },
      select: { id: true },
    });
    if (recent) continue;

    await prisma.dealActivity.create({
      data: {
        dealId: d.id,
        companyId: d.companyId,
        type: 'CUSTOM',
        actorType: 'system',
        title: `stalled — no activity for ${STALL_THRESHOLD_DAYS}+ days`,
        body: `"${d.title}" has not been touched in over ${STALL_THRESHOLD_DAYS} days`,
      },
    });
    result.stalled++;
  }

  result.scanned = missingCycle.length + overdue.length + stalled.length;
  return result;
}

export function startDealCycleProcessor(): Worker {
  const worker = new Worker(
    QUEUES.DEAL_CYCLE,
    async (_job: Job) => {
      const result = await runDealCycle();
      logger.info(result, 'Deal cycle housekeeping complete');
      return result;
    },
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'deal cycle failed'));
  logger.info('Deal cycle processor started');
  return worker;
}

export function dealCycleQueue(): Queue {
  return new Queue(QUEUES.DEAL_CYCLE, {
    connection: new Redis((process.env.REDIS_URL || '').trim(), { maxRetriesPerRequest: null }),
  });
}
