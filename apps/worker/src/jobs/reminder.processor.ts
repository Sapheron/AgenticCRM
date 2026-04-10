/**
 * Reminder processor — runs every minute via BullMQ repeat job.
 *
 * Reads each task's `reminderOffsets` array (e.g. [60, 30, 5] = 60 / 30 / 5
 * minutes before dueAt) and fires a WS notification for any offset that
 * is now due AND hasn't already been fired (tracked via `remindersSent[]`).
 *
 * Each task can have multiple reminders. The legacy `reminderSentAt` column
 * is still updated for backwards compatibility but the canonical state is
 * the `remindersSent` history array.
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
      const now = new Date();
      // Pull a wide window of upcoming tasks. The cap of 60 min covers the
      // longest configured offset by default; if a user sets `[1440]` (a day
      // ahead) we still fire the reminder when it falls within `lookAhead`,
      // so widen the window to the maximum of all configured offsets.
      const maxConfigured = await prisma.task.findMany({
        where: { status: { in: ['TODO', 'IN_PROGRESS'] } },
        select: { reminderOffsets: true },
        take: 500,
      });
      const maxOffset = maxConfigured.reduce(
        (acc, t) => Math.max(acc, ...(t.reminderOffsets ?? [30])),
        30,
      );
      const lookAhead = new Date(now.getTime() + maxOffset * 60 * 1000);

      const tasks = await prisma.task.findMany({
        where: {
          status: { in: ['TODO', 'IN_PROGRESS'] },
          dueAt: { lte: lookAhead, gt: now },
        },
        include: {
          assignedAgent: { select: { id: true, email: true, firstName: true, companyId: true } },
          contact: { select: { id: true, displayName: true } },
        },
      });

      for (const task of tasks) {
        if (!task.dueAt) continue;
        const offsets = task.reminderOffsets ?? [30];
        const remindersSent = task.remindersSent ?? [];
        const fired: Date[] = [];

        for (const offsetMinutes of offsets) {
          const fireAt = new Date(task.dueAt.getTime() - offsetMinutes * 60 * 1000);
          if (now < fireAt) continue; // not yet due to fire

          // Has this exact offset already been fired? Compare by minute granularity:
          // a `remindersSent` entry within the same minute as fireAt counts as fired.
          const alreadyFired = remindersSent.some(
            (sent) => Math.abs(sent.getTime() - fireAt.getTime()) < 60 * 1000,
          );
          if (alreadyFired) continue;

          fired.push(fireAt);

          // Emit WS notification to the agent
          if (task.assignedAgent) {
            const redis2 = new Redis(redisUrl);
            await redis2.publish(`company:${task.assignedAgent.companyId}:events`, JSON.stringify({
              event: 'notification.new',
              data: {
                title: 'Task reminder',
                body: `"${task.title}" is due in ${offsetMinutes} minutes`,
                type: 'task',
                link: `/tasks/${task.id}`,
              },
            }));
            await redis2.quit();
          }

          // Drop a TaskActivity row so the timeline shows the reminder
          await prisma.taskActivity.create({
            data: {
              taskId: task.id,
              companyId: task.assignedAgent?.companyId ?? '',
              type: 'REMINDER_SENT',
              actorType: 'system',
              title: `Reminder fired (${offsetMinutes} min before due)`,
              metadata: { offsetMinutes, fireAt },
            },
          }).catch(() => undefined);

          logger.info(
            { taskId: task.id, offsetMinutes, dueAt: task.dueAt },
            'Sent task reminder',
          );
        }

        if (fired.length > 0) {
          await prisma.task.update({
            where: { id: task.id },
            data: {
              remindersSent: { push: fired },
              reminderSentAt: fired[fired.length - 1], // legacy mirror
            },
          });
        }
      }
    },
    { connection, concurrency: 1 },
  );

  return worker;
}
