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
import { startMemoryDreamingProcessor, memoryDreamingQueue } from './jobs/memory-dreaming.processor';
import { startLeadDecayProcessor, leadDecayQueue } from './jobs/lead-decay.processor';
import { startDealCycleProcessor, dealCycleQueue } from './jobs/deal-cycle.processor';
import { startTaskCycleProcessor, taskCycleQueue } from './jobs/task-cycle.processor';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

const redis = new Redis((process.env.REDIS_URL || '').trim(), { lazyConnect: true });

async function main() {
  logger.info('Worker service starting');

  // Connect Redis client for publisher init
  await redis.connect();
  logger.info('Redis connected');

  // Start all workers
  const aiWorker = startAiMessageWorker();
  logger.info('AI message worker started');

  const broadcastWorker = startBroadcastWorker();
  logger.info('Broadcast worker started');

  // Broadcast queue handle, passed to the reminder worker so it can dispatch
  // due SCHEDULED broadcasts every minute (piggybacks on the reminder cron).
  const broadcastQueueForDispatcher = new Queue(QUEUES.BROADCAST, {
    connection: new Redis((process.env.REDIS_URL || '').trim(), { maxRetriesPerRequest: null }),
  });
  const reminderWorker = startReminderWorker(broadcastQueueForDispatcher);
  const followUpWorker = startFollowUpProcessor();
  const cleanupWorker = startCleanupProcessor();
  const paymentCheckWorker = startPaymentCheckProcessor();
  const warmupResetWorker = startWarmupResetProcessor();
  const memoryDreamingWorker = startMemoryDreamingProcessor();
  const leadDecayWorker = startLeadDecayProcessor();
  const dealCycleWorker = startDealCycleProcessor();
  const taskCycleWorker = startTaskCycleProcessor();
  logger.info('All workers started');

  // Schedule recurring jobs via BullMQ repeatable jobs
  const reminderQueue    = new Queue(QUEUES.REMINDER,       { connection: new Redis((process.env.REDIS_URL || '').trim(), { maxRetriesPerRequest: null }) });
  const followUpQueue    = new Queue(QUEUES.FOLLOW_UP,      { connection: new Redis((process.env.REDIS_URL || '').trim(), { maxRetriesPerRequest: null }) });
  const cleanupQueue     = new Queue(QUEUES.CLEANUP,        { connection: new Redis((process.env.REDIS_URL || '').trim(), { maxRetriesPerRequest: null }) });
  const paymentCheckQ    = new Queue(QUEUES.PAYMENT_CHECK,  { connection: new Redis((process.env.REDIS_URL || '').trim(), { maxRetriesPerRequest: null }) });
  const warmupResetQueue = new Queue(QUEUES.WARMUP_RESET,   { connection: new Redis((process.env.REDIS_URL || '').trim(), { maxRetriesPerRequest: null }) });

  await scheduleReminderJob(reminderQueue);

  // Every 30 min
  await followUpQueue.add('follow-up', {}, { repeat: { pattern: '*/30 * * * *' }, jobId: 'follow-up-recurring' });
  // Daily at 2am
  await cleanupQueue.add('cleanup', {}, { repeat: { pattern: '0 2 * * *' }, jobId: 'cleanup-recurring' });
  // Every 15 min
  await paymentCheckQ.add('payment-check', {}, { repeat: { pattern: '*/15 * * * *' }, jobId: 'payment-check-recurring' });
  // Daily at midnight
  await warmupResetQueue.add('warmup-reset', {}, { repeat: { pattern: '0 0 * * *' }, jobId: 'warmup-reset-recurring' });
  // Memory dreaming: every 6 hours — promotes high-recall snippets to MEMORY.md
  const dreamingQueue = memoryDreamingQueue();
  await dreamingQueue.add('memory-dreaming', {}, { repeat: { pattern: '0 */6 * * *' }, jobId: 'memory-dreaming-recurring' });
  // Lead decay: daily at 03:00 — recalculates scores for stale leads
  const decayQueue = leadDecayQueue();
  await decayQueue.add('lead-decay', {}, { repeat: { pattern: '0 3 * * *' }, jobId: 'lead-decay-recurring' });
  // Deal cycle housekeeping: daily at 04:00 — backfill cycles, flag overdue/stalled
  const dCycleQueue = dealCycleQueue();
  await dCycleQueue.add('deal-cycle', {}, { repeat: { pattern: '0 4 * * *' }, jobId: 'deal-cycle-recurring' });
  // Task cycle housekeeping: daily at 05:00 — escalate overdue, cleanup TTL, generate recurring instances
  const tCycleQueue = taskCycleQueue();
  await tCycleQueue.add('task-cycle', {}, { repeat: { pattern: '0 5 * * *' }, jobId: 'task-cycle-recurring' });

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
      memoryDreamingWorker.close(),
      leadDecayWorker.close(),
      dealCycleWorker.close(),
      taskCycleWorker.close(),
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
