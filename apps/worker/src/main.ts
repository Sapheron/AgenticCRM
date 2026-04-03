/**
 * Worker service entrypoint.
 * Starts all BullMQ workers:
 * - AI message processor (main agent loop)
 * - Broadcast processor
 * - Reminder processor
 * - Follow-up processor
 * - Cleanup processor
 * - Payment-check processor
 * - Warmup-reset processor
 */
import 'dotenv/config';
import pino from 'pino';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { QUEUES } from '@wacrm/shared';
import { startAiMessageWorker } from './jobs/ai-message.processor';
import { startBroadcastWorker } from './jobs/broadcast.processor';
import { startReminderWorker, scheduleReminderJob } from './jobs/reminder.processor';
import { startFollowUpProcessor } from './jobs/follow-up.processor';
import { startCleanupProcessor } from './jobs/cleanup.processor';
import { startPaymentCheckProcessor } from './jobs/payment-check.processor';
import { startWarmupResetProcessor } from './jobs/warmup-reset.processor';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

const redisUrl = process.env.REDIS_URL!;

async function main() {
  logger.info('Worker service starting');

  // Connect Redis client for publisher init
  const redis = new Redis(redisUrl);
  await redis.ping();
  logger.info('Redis connected');

  // Start all workers
  const aiWorker = startAiMessageWorker();
  logger.info('AI message worker started');

  const broadcastWorker = startBroadcastWorker();
  logger.info('Broadcast worker started');

  const reminderWorker = startReminderWorker();
  const followUpWorker = startFollowUpProcessor();
  const cleanupWorker = startCleanupProcessor();
  const paymentCheckWorker = startPaymentCheckProcessor();
  const warmupResetWorker = startWarmupResetProcessor();
  logger.info('All workers started');

  // Schedule recurring jobs via BullMQ repeatable jobs
  const reminderQueue    = new Queue(QUEUES.REMINDER,       { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }) });
  const followUpQueue    = new Queue(QUEUES.FOLLOW_UP,      { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }) });
  const cleanupQueue     = new Queue(QUEUES.CLEANUP,        { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }) });
  const paymentCheckQ    = new Queue(QUEUES.PAYMENT_CHECK,  { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }) });
  const warmupResetQueue = new Queue(QUEUES.WARMUP_RESET,   { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }) });

  await scheduleReminderJob(reminderQueue);

  // Every 30 min
  await followUpQueue.add('follow-up', {}, { repeat: { pattern: '*/30 * * * *' }, jobId: 'follow-up-recurring' });
  // Daily at 2am
  await cleanupQueue.add('cleanup', {}, { repeat: { pattern: '0 2 * * *' }, jobId: 'cleanup-recurring' });
  // Every 15 min
  await paymentCheckQ.add('payment-check', {}, { repeat: { pattern: '*/15 * * * *' }, jobId: 'payment-check-recurring' });
  // Daily at midnight
  await warmupResetQueue.add('warmup-reset', {}, { repeat: { pattern: '0 0 * * *' }, jobId: 'warmup-reset-recurring' });

  logger.info('Worker service ready — all workers running');

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down workers');
    await Promise.all([
      aiWorker.close(),
      broadcastWorker.close(),
      reminderWorker.close(),
      followUpWorker.close(),
      cleanupWorker.close(),
      paymentCheckWorker.close(),
      warmupResetWorker.close(),
    ]);
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err: unknown) => {
  logger.error(err, 'Fatal error in worker service');
  process.exit(1);
});
