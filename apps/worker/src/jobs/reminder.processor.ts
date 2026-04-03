/**
 * Reminder processor: runs every minute via BullMQ repeat job.
 * Finds tasks due in 30 min and sends notifications.
 */
import { Queue, Worker, type Job } from 'bullmq';
import pino from 'pino';
import Redis from 'ioredis';
import { QUEUES } from '@wacrm/shared';
import { prisma } from '@wacrm/database';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const redisUrl = process.env.REDIS_URL!;

export async function scheduleReminderJob(queue: Queue) {
  await queue.add(
    'check-reminders',
    {},
    {
      repeat: { every: 60000 }, // every minute
      jobId: 'reminder-check',
    },
  );
}

export function startReminderWorker() {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const worker = new Worker(
    QUEUES.REMINDER,
    async (_job: Job) => {
      const soon = new Date(Date.now() + 30 * 60 * 1000);
      const tasks = await prisma.task.findMany({
        where: {
          status: { in: ['TODO', 'IN_PROGRESS'] },
          dueAt: { lte: soon, gt: new Date() },
          reminderSentAt: null,
        },
        include: {
          assignedAgent: { select: { id: true, email: true, firstName: true, companyId: true } },
          contact: { select: { id: true, displayName: true } },
        },
      });

      for (const task of tasks) {
        logger.info({ taskId: task.id, dueAt: task.dueAt }, 'Sending task reminder');

        // Emit WS notification to the agent
        if (task.assignedAgent) {
          const redis2 = new Redis(redisUrl);
          await redis2.publish(`company:${task.assignedAgent.companyId}:events`, JSON.stringify({
            event: 'notification.new',
            data: {
              title: 'Task due soon',
              body: `"${task.title}" is due in 30 minutes`,
              type: 'task',
              link: `/tasks`,
            },
          }));
          await redis2.quit();
        }

        await prisma.task.update({
          where: { id: task.id },
          data: { reminderSentAt: new Date() },
        });
      }
    },
    { connection, concurrency: 1 },
  );

  return worker;
}
