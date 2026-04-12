/**
 * Pure SLA helpers for tickets — no DB/IO access.
 *
 * - `computeSlaDue` — given a creation time and a policy, return the
 *   first-response and resolution due dates.
 * - `isBreached` — check whether a due date has passed.
 * - `generateTicketNumber` — TKT-YYMMDD-XXX (callers check uniqueness).
 */

export interface SlaPolicySnap {
  firstResponseMins: number;
  resolutionMins: number;
}

export interface SlaDates {
  firstResponseDue: Date;
  resolutionDue: Date;
}

export function computeSlaDue(
  createdAt: Date,
  policy: SlaPolicySnap,
): SlaDates {
  return {
    firstResponseDue: new Date(
      createdAt.getTime() + policy.firstResponseMins * 60 * 1000,
    ),
    resolutionDue: new Date(
      createdAt.getTime() + policy.resolutionMins * 60 * 1000,
    ),
  };
}

export function isBreached(
  due: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!due) return false;
  return now.getTime() > due.getTime();
}

export function generateTicketNumber(now: Date = new Date()): string {
  const yy = String(now.getFullYear() % 100).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `TKT-${yy}${mm}${dd}-${rand}`;
}
