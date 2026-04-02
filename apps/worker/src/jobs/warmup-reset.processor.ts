/**
 * Warmup reset processor — runs daily at midnight.
 * Resets messagesSentToday counter for all WhatsApp accounts
 * and advances warmup stage for accounts that hit their daily limit.
 *
 * Warmup stages (daily limits):
 *   0 → 50  messages/day
 *   1 → 100
 *   2 → 200
 *   3 → 500
 *   4 → 1000
 *   5 → unlimited (warmup complete)
 */
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { prisma } from '@wacrm/database';
import { QUEUES } from '@wacrm/shared';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });

const WARMUP_DAILY_LIMITS = [50, 100, 200, 500, 1000, 99999];

export function startWarmupResetProcessor(): Worker {
  const worker = new Worker(
    QUEUES.WARMUP_RESET,
    async (_job: Job) => {
      const accounts = await prisma.whatsAppAccount.findMany({
        where: { status: 'CONNECTED' },
        select: { id: true, warmupStage: true, messagesSentToday: true, dailyMessageLimit: true },
      });

      let advanced = 0;
      let reset = 0;

      for (const account of accounts) {
        const currentStage = account.warmupStage;
        const nextStage = Math.min(currentStage + 1, 5);
        const hitLimit = account.messagesSentToday >= account.dailyMessageLimit;

        // Advance stage if account hit its limit (proof of healthy sending)
        const newStage = hitLimit && currentStage < 5 ? nextStage : currentStage;
        const newLimit = WARMUP_DAILY_LIMITS[newStage] ?? 99999;

        await prisma.whatsAppAccount.update({
          where: { id: account.id },
          data: {
            messagesSentToday: 0,
            warmupStage: newStage,
            dailyMessageLimit: newLimit,
          },
        });

        if (newStage > currentStage) advanced++;
        reset++;
      }

      const result = { accountsReset: reset, stagesAdvanced: advanced };
      logger.info(result, 'Warmup reset complete');
      return result;
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'warmup-reset job failed');
  });

  logger.info('Warmup-reset processor started');
  return worker;
}
