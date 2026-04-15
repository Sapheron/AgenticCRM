/**
 * Shared inbound activity tracker — used by both session.manager.ts and monitor.ts.
 * Extracted to its own file to avoid circular imports between the two.
 */

// Track last inbound activity per account for stale connection detection
// Matches OpenClaw's WhatsAppConnectionController.lastInboundAt
const lastInboundAt = new Map<string, number>();

/** Called by InboundMonitor when any message arrives */
export function noteInboundActivity(accountId: string): void {
  lastInboundAt.set(accountId, Date.now());
}

/** Get the last inbound timestamp for an account */
export function getLastInboundAt(accountId: string): number {
  return lastInboundAt.get(accountId) ?? 0;
}

/** Set initial activity baseline on connect */
export function setInboundBaseline(accountId: string): void {
  lastInboundAt.set(accountId, Date.now());
}

/** Clear activity tracking for an account */
export function clearInboundActivity(accountId: string): void {
  lastInboundAt.delete(accountId);
}
