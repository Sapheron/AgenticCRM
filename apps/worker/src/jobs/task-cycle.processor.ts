/**
 * Task Cycle processor — runs daily at 05:00.
 *
 * Three housekeeping passes:
 *   1. **Auto-escalate priority** of overdue, still-open tasks (LOW→MEDIUM,
 *      MEDIUM→HIGH, HIGH→URGENT). Drops a `PRIORITY_CHANGED` activity row
 *      with `actorType: 'system'` so the timeline shows what happened.
 *   2. **Cleanup TTL** — hard-delete tasks where `cleanupAfter < now`, but
 *      only if they're terminal (DONE/CANCELLED), have no comments, and
 *      have no subtasks. Mirrors OpenClaw's `cleanupAfter` pattern.
 *   3. **Recurrence engine** — for every active TaskRecurrence whose
 *      `nextRunAt <= now`, generate a new Task instance and advance
 *      `nextRunAt` via the same pure helper used by the API service.
 *
 * Self-contained — no cross-app imports. Mirrors `lead-decay.processor.ts`.
 */
import { Worker, Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { prisma } from '@wacrm/database';
import type { TaskPriority, TaskRecurrenceFrequency } from '@wacrm/database';
import { QUEUES } from '@wacrm/shared';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 200;
const PRIORITY_LADDER: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

// ── Recurrence helper (duplicated from apps/api/src/modules/tasks/recurrence.ts
// to keep this processor self-contained — same pattern as lead-decay duplicates
// scoring rules from the api side) ─────────────────────────────────────────

interface RecurrenceRule {
  frequency: TaskRecurrenceFrequency;
  intervalDays?: number | null;
  daysOfWeek?: number[];
  dayOfMonth?: number | null;
  startsAt: Date;
  endsAt?: Date | null;
}

function computeNextRunAt(rule: RecurrenceRule, from: Date): Date | null {
  if (rule.endsAt && from.getTime() >= rule.endsAt.getTime()) return null;
  let next: Date;
  switch (rule.frequency) {
    case 'DAILY':
      next = new Date(from.getTime() + DAY_MS);
      break;
    case 'CUSTOM_DAYS': {
      const interval = Math.max(1, rule.intervalDays ?? 1);
      next = new Date(from.getTime() + interval * DAY_MS);
      break;
    }
    case 'WEEKLY': {
      const days = (rule.daysOfWeek?.length ? rule.daysOfWeek : [from.getDay()]).slice().sort();
      const fromDay = from.getDay();
      let addDays = 7;
      for (const d of days) {
        if (d > fromDay) {
          addDays = d - fromDay;
          break;
        }
      }
      if (addDays === 7) addDays = 7 - fromDay + days[0];
      next = new Date(from.getTime() + addDays * DAY_MS);
      break;
    }
    case 'MONTHLY': {
      const day = rule.dayOfMonth ?? from.getDate();
      next = new Date(from);
      next.setMonth(next.getMonth() + 1);
      const daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(day, daysInMonth));
      break;
    }
    case 'QUARTERLY':
      next = new Date(from);
      next.setMonth(next.getMonth() + 3);
      break;
    case 'YEARLY':
      next = new Date(from);
      next.setFullYear(next.getFullYear() + 1);
      break;
    default:
      return null;
  }
  next.setHours(rule.startsAt.getHours(), rule.startsAt.getMinutes(), 0, 0);
  if (rule.endsAt && next.getTime() > rule.endsAt.getTime()) return null;
  return next;
}

// ── Passes ──────────────────────────────────────────────────────────────────

async function escalateOverdue(): Promise<number> {
  const now = new Date();
  const overdueTasks = await prisma.task.findMany({
    where: {
      status: { in: ['TODO', 'IN_PROGRESS'] },
      dueAt: { lt: now },
      priority: { not: 'URGENT' },
    },
    select: { id: true, companyId: true, priority: true, title: true },
    take: BATCH_SIZE,
  });

  let escalated = 0;
  for (const t of overdueTasks) {
    const idx = PRIORITY_LADDER.indexOf(t.priority);
    if (idx < 0 || idx >= PRIORITY_LADDER.length - 1) continue;
    const next = PRIORITY_LADDER[idx + 1];
    await prisma.task.update({ where: { id: t.id }, data: { priority: next } });
    await prisma.taskActivity.create({
      data: {
        taskId: t.id,
        companyId: t.companyId,
        type: 'PRIORITY_CHANGED',
        actorType: 'system',
        title: `Auto-escalated ${t.priority} → ${next} (overdue)`,
        metadata: { fromPriority: t.priority, toPriority: next, reason: 'overdue' },
      },
    });
    escalated++;
  }
  return escalated;
}

async function cleanupExpired(): Promise<number> {
  const now = new Date();
  const expired = await prisma.task.findMany({
    where: {
      status: { in: ['DONE', 'CANCELLED'] },
      cleanupAfter: { lt: now },
    },
    select: {
      id: true,
      _count: { select: { comments: true, subtasks: true } },
    },
    take: BATCH_SIZE,
  });

  let deleted = 0;
  for (const t of expired) {
    if (t._count.comments > 0 || t._count.subtasks > 0) continue;
    await prisma.task.delete({ where: { id: t.id } });
    deleted++;
  }
  return deleted;
}

async function spawnRecurringInstances(): Promise<number> {
  const now = new Date();
  const due = await prisma.taskRecurrence.findMany({
    where: { isActive: true, nextRunAt: { lte: now } },
    take: BATCH_SIZE,
  });

  let generated = 0;
  for (const r of due) {
    try {
      const next = computeNextRunAt(
        {
          frequency: r.frequency,
          intervalDays: r.intervalDays,
          daysOfWeek: r.daysOfWeek,
          dayOfMonth: r.dayOfMonth,
          startsAt: r.startsAt,
          endsAt: r.endsAt,
        },
        r.nextRunAt,
      );

      const task = await prisma.task.create({
        data: {
          companyId: r.companyId,
          title: r.templateTitle,
          description: r.templateBody,
          priority: r.templatePriority,
          assignedAgentId: r.templateAssignedAgentId,
          source: 'RECURRING',
          recurrenceId: r.id,
          dueAt: r.nextRunAt,
          status: 'TODO',
        },
      });
      await prisma.taskActivity.create({
        data: {
          taskId: task.id,
          companyId: r.companyId,
          type: 'RECURRENCE_TRIGGERED',
          actorType: 'recurrence',
          title: `Generated from recurring series ${r.id}`,
          metadata: { recurrenceId: r.id, generationNumber: r.totalGenerated + 1 },
        },
      });
      await prisma.taskRecurrence.update({
        where: { id: r.id },
        data: {
          lastRunAt: r.nextRunAt,
          nextRunAt: next ?? r.nextRunAt,
          isActive: next !== null,
          totalGenerated: { increment: 1 },
        },
      });
      generated++;
    } catch (err: unknown) {
      logger.warn({ err, recurrenceId: r.id }, 'Failed to spawn recurring task instance');
    }
  }
  return generated;
}

async function runTaskCycle(): Promise<{ escalated: number; cleaned: number; generated: number }> {
  const escalated = await escalateOverdue();
  const cleaned = await cleanupExpired();
  const generated = await spawnRecurringInstances();
  return { escalated, cleaned, generated };
}

export function startTaskCycleProcessor(): Worker {
  const worker = new Worker(
    QUEUES.TASK_CYCLE,
    async (_job: Job) => {
      const result = await runTaskCycle();
      logger.info(result, 'Task cycle housekeeping complete');
      return result;
    },
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'task cycle failed'));
  logger.info('Task cycle processor started');
  return worker;
}

export function taskCycleQueue(): Queue {
  return new Queue(QUEUES.TASK_CYCLE, {
    connection: new Redis((process.env.REDIS_URL || '').trim(), { maxRetriesPerRequest: null }),
  });
}
