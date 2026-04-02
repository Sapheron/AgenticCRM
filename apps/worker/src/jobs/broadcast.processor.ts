import { Worker, type Job } from 'bullmq';
import pino from 'pino';
import Redis from 'ioredis';
import { QUEUES } from '@wacrm/shared';
import { prisma } from '@wacrm/database';
import { sleep } from '@wacrm/shared';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

export function startBroadcastWorker() {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const worker = new Worker(
    QUEUES.BROADCAST,
    async (job: Job) => {
      const { broadcastId, companyId } = job.data as { broadcastId: string; companyId: string };
      logger.info({ broadcastId }, 'Processing broadcast');

      const broadcast = await prisma.broadcast.findUnique({ where: { id: broadcastId } });
      if (!broadcast) return;

      await prisma.broadcast.update({ where: { id: broadcastId }, data: { startedAt: new Date() } });

      // Resolve target contacts
      const where = {
        companyId,
        deletedAt: null,
        optedOut: false,
        ...(broadcast.targetTags.length ? { tags: { hasSome: broadcast.targetTags } } : {}),
        ...(broadcast.targetContactIds.length ? { id: { in: broadcast.targetContactIds } } : {}),
      };

      const contacts = await prisma.contact.findMany({
        where,
        select: { id: true, phoneNumber: true },
      });

      let sentCount = 0;
      let failedCount = 0;

      for (const contact of contacts) {
        try {
          // Publish to WhatsApp outbound queue via Redis
          const connection2 = new Redis(redisUrl);
          await connection2.publish('wa:broadcast', JSON.stringify({
            companyId,
            contactId: contact.id,
            toPhone: contact.phoneNumber,
            text: broadcast.message,
            mediaUrl: broadcast.mediaUrl,
          }));
          await connection2.quit();

          sentCount++;
          // Throttle: 1 message per 1–3 seconds to avoid bans
          await sleep(1000 + Math.random() * 2000);
        } catch (err) {
          failedCount++;
          logger.error({ broadcastId, contactId: contact.id, err }, 'Failed to send broadcast message');
        }

        // Update progress every 10 messages
        if ((sentCount + failedCount) % 10 === 0) {
          await prisma.broadcast.update({
            where: { id: broadcastId },
            data: { sentCount, failedCount },
          });
        }
      }

      await prisma.broadcast.update({
        where: { id: broadcastId },
        data: { sentCount, failedCount, completedAt: new Date() },
      });

      logger.info({ broadcastId, sentCount, failedCount }, 'Broadcast completed');
    },
    { connection, concurrency: 1 }, // broadcasts run one at a time
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Broadcast job failed');
  });

  return worker;
}
