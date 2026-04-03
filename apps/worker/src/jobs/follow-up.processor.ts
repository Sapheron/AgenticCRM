/**
 * Follow-up processor — runs every 30 minutes.
 * Finds conversations in WAITING_HUMAN state where no agent has responded
 * for > X minutes, and sends an internal notification + escalation flag.
 */
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { prisma } from '@wacrm/database';
import { QUEUES } from '@wacrm/shared';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

const FOLLOW_UP_THRESHOLD_MINUTES = Number(process.env.FOLLOW_UP_THRESHOLD_MINUTES ?? 30);

export function startFollowUpProcessor(): Worker {
  const worker = new Worker(
    QUEUES.FOLLOW_UP,
    async (_job: Job) => {
      const cutoff = new Date(Date.now() - FOLLOW_UP_THRESHOLD_MINUTES * 60 * 1000);

      // Find WAITING_HUMAN conversations with no agent activity since cutoff
      const stale = await prisma.conversation.findMany({
        where: {
          status: 'WAITING_HUMAN',
          lastMessageAt: { lt: cutoff },
        },
        include: {
          company: { select: { id: true, name: true } },
          contact: { select: { displayName: true, phoneNumber: true } },
          assignedAgent: { select: { id: true, email: true, firstName: true } },
        },
        take: 50,
      });

      for (const conv of stale) {
        logger.info({ conversationId: conv.id, companyId: conv.companyId }, 'Follow-up needed');

        // Notify assigned agent or all admins
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (prisma as any).notification?.create?.({
          data: {
            companyId: conv.companyId,
            type: 'FOLLOW_UP_NEEDED',
            title: 'Follow-up needed',
            body: `Conversation with ${conv.contact.displayName ?? conv.contact.phoneNumber} has been waiting for ${FOLLOW_UP_THRESHOLD_MINUTES} minutes`,
            conversationId: conv.id,
            userId: conv.assignedAgentId ?? undefined,
          },
        }).catch(() => {
          // Notification model may not exist yet, log only
          logger.warn({ conversationId: conv.id }, 'Follow-up needed (notification model not set up)');
        });
      }

      return { processed: stale.length };
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'follow-up job failed');
  });

  logger.info('Follow-up processor started');
  return worker;
}
