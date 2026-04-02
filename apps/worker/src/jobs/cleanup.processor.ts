/**
 * Cleanup processor — runs daily at 2am.
 * - Closes conversations idle for 7 days (per FSM idle_7_days event)
 * - Purges soft-deleted contacts older than 90 days
 * - Purges audit logs older than 180 days
 */
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { prisma } from '@wacrm/database';
import { QUEUES } from '@wacrm/shared';
import { transitionFsm } from '@wacrm/shared';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });

export function startCleanupProcessor(): Worker {
  const worker = new Worker(
    QUEUES.CLEANUP,
    async (_job: Job) => {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      const oneEightyDaysAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

      // 1. Close idle conversations (7 days)
      const idleConvs = await prisma.conversation.findMany({
        where: {
          status: { in: ['OPEN', 'WAITING_HUMAN', 'AI_HANDLING'] },
          lastMessageAt: { lt: sevenDaysAgo },
        },
        select: { id: true, status: true },
      });

      let closedCount = 0;
      for (const conv of idleConvs) {
        const nextState = transitionFsm(conv.status as any, 'idle_7_days');
        if (nextState) {
          await prisma.conversation.update({
            where: { id: conv.id },
            data: { status: nextState as any },
          });
          closedCount++;
        }
      }

      // 2. Hard-delete soft-deleted contacts older than 90 days
      const deletedContacts = await prisma.contact.deleteMany({
        where: { deletedAt: { lt: ninetyDaysAgo } },
      });

      // 3. Purge old audit logs
      const deletedAuditLogs = await prisma.auditLog.deleteMany({
        where: { createdAt: { lt: oneEightyDaysAgo } },
      });

      const result = {
        closedConversations: closedCount,
        deletedContacts: deletedContacts.count,
        deletedAuditLogs: deletedAuditLogs.count,
      };

      logger.info(result, 'Cleanup complete');
      return result;
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'cleanup job failed');
  });

  logger.info('Cleanup processor started');
  return worker;
}
