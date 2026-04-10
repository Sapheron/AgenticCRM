/**
 * Recurrence helpers — pure functions that compute the next-run timestamp
 * for a TaskRecurrence row given its frequency + cadence rules.
 *
 * Used by:
 *   - TasksService.createRecurrence (to set the initial nextRunAt)
 *   - TasksService when an instance is generated (to advance nextRunAt)
 *   - The worker's task-cycle processor (same advance logic)
 */
import type { TaskRecurrenceFrequency } from '@wacrm/database';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecurrenceRule {
  frequency: TaskRecurrenceFrequency;
  intervalDays?: number | null;
  daysOfWeek?: number[];     // 0=Sun..6=Sat (used for WEEKLY)
  dayOfMonth?: number | null; // 1..31 (used for MONTHLY)
  startsAt: Date;
  endsAt?: Date | null;
}

/**
 * Compute the next valid run time strictly after `from`. If the recurrence
 * has an `endsAt` and we're past it, returns null (caller should mark inactive).
 */
export function computeNextRunAt(rule: RecurrenceRule, from: Date): Date | null {
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
      // Find the next day-of-week strictly after `from`.
      const fromDay = from.getDay();
      let addDays = 7;
      for (const d of days) {
        if (d > fromDay) {
          addDays = d - fromDay;
          break;
        }
      }
      // Wrap to next week if all configured days are <= fromDay
      if (addDays === 7) {
        addDays = 7 - fromDay + days[0];
      }
      next = new Date(from.getTime() + addDays * DAY_MS);
      break;
    }

    case 'MONTHLY': {
      const day = rule.dayOfMonth ?? from.getDate();
      next = new Date(from);
      next.setMonth(next.getMonth() + 1);
      // Clamp to last day of the target month if `day` overflows
      const daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(day, daysInMonth));
      break;
    }

    case 'QUARTERLY': {
      next = new Date(from);
      next.setMonth(next.getMonth() + 3);
      break;
    }

    case 'YEARLY': {
      next = new Date(from);
      next.setFullYear(next.getFullYear() + 1);
      break;
    }

    default:
      return null;
  }

  // Preserve hour/minute from the start of the series, not from `from`,
  // so daily standups stay at 10am even if you complete one early.
  next.setHours(rule.startsAt.getHours(), rule.startsAt.getMinutes(), 0, 0);

  if (rule.endsAt && next.getTime() > rule.endsAt.getTime()) return null;
  return next;
}
