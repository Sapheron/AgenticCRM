import { Worker, type Job } from 'bullmq';
import pino from 'pino';
import Redis from 'ioredis';
import { QUEUES } from '@wacrm/shared';
import { runAgentLoop } from '../agent/agent-loop';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

export function startAiMessageWorker() {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const worker = new Worker(
    QUEUES.AI_MESSAGE,
    async (job: Job) => {
      logger.info({ jobId: job.id, data: job.data }, 'Processing AI message job');
      await runAgentLoop(job.data as Parameters<typeof runAgentLoop>[0]);
    },
    {
      connection,
      concurrency: 10,
      limiter: { max: 50, duration: 1000 }, // 50 jobs/sec max
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'AI message job failed');
  });

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'AI message job completed');
  });

  return worker;
}
