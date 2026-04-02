/**
 * Payment check processor — runs every 15 minutes.
 * Finds PENDING payments older than 24h and marks them EXPIRED.
 * Also nudges contacts about unpaid payment links via WhatsApp (once, after 2h).
 */
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { prisma } from '@wacrm/database';
import { QUEUES } from '@wacrm/shared';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
const publisher = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

export function startPaymentCheckProcessor(): Worker {
  const worker = new Worker(
    QUEUES.PAYMENT_CHECK,
    async (_job: Job) => {
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      // 1. Expire old pending payments
      const expired = await prisma.payment.updateMany({
        where: {
          status: 'PENDING',
          createdAt: { lt: twentyFourHoursAgo },
        },
        data: { status: 'EXPIRED' },
      });

      // 2. Nudge for payments created 2h ago, not yet nudged, not yet paid
      const toNudge = await prisma.payment.findMany({
        where: {
          status: 'PENDING',
          nudgeSentAt: null,
          createdAt: { lt: twoHoursAgo, gt: twentyFourHoursAgo },
          linkUrl: { not: null },
        },
        include: {
          contact: { select: { phoneNumber: true, displayName: true } },
          deal: { select: { whatsappAccountId: true } },
        },
        take: 50,
      });

      for (const payment of toNudge) {
        if (!payment.deal?.whatsappAccountId || !payment.contact?.phoneNumber) continue;

        const nudgeText = `Hi ${payment.contact.displayName ?? 'there'}, just a reminder about your pending payment of ${payment.currency} ${(payment.amount / 100).toFixed(2)}. You can complete it here: ${payment.linkUrl}`;

        await publisher.publish('wa:outbound', JSON.stringify({
          accountId: payment.deal.whatsappAccountId,
          toPhone: payment.contact.phoneNumber,
          text: nudgeText,
        }));

        await prisma.payment.update({
          where: { id: payment.id },
          data: { nudgeSentAt: new Date() },
        });
      }

      const result = { expiredPayments: expired.count, nudgesSent: toNudge.length };
      logger.info(result, 'Payment check complete');
      return result;
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'payment-check job failed');
  });

  logger.info('Payment-check processor started');
  return worker;
}
