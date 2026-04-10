/**
 * Lead Scoring rule engine.
 *
 * Each rule receives a snapshot of the lead + recent message history and
 * returns a `(delta, reason)` pair if the rule fires. Deltas are summed,
 * the score is clamped to [0, 100], and the engine writes one
 * `LeadScoreEvent` per applied rule so we can show a per-event audit trail.
 *
 * The engine is intentionally deterministic — no LLM calls. The AI chat
 * can still adjust scores manually via the `score_lead` tool, which writes
 * an event with `source: 'ai'`. Only `recalculateScore()` writes
 * `source: 'rule:<name>'` events.
 */
import type { Lead, Message } from '@wacrm/database';

export interface ScoreSnapshot {
  lead: Pick<
    Lead,
    | 'id'
    | 'companyId'
    | 'status'
    | 'tags'
    | 'estimatedValue'
    | 'createdAt'
    | 'updatedAt'
    | 'score'
  >;
  /** Recent inbound + outbound messages from the contact, newest first. */
  recentMessages: Pick<Message, 'id' | 'direction' | 'createdAt'>[];
  /** Outcome of the previous score, used by some rules to avoid double-counting. */
  previousScore: number;
}

export interface ScoreRuleHit {
  rule: string;
  delta: number;
  reason: string;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Run all rules over a snapshot. Returns the list of rules that fired plus
 * the new clamped score. The caller is responsible for persisting events.
 */
export function applyScoringRules(snap: ScoreSnapshot): {
  hits: ScoreRuleHit[];
  newScore: number;
} {
  const hits: ScoreRuleHit[] = [];
  const lead = snap.lead;

  // Bonus on creation — only fires if score is still 0 (i.e. brand new).
  if (snap.previousScore === 0) {
    hits.push({ rule: 'new_lead', delta: 5, reason: 'New lead created' });
  }

  // Inbound reply after at least one outbound message.
  const inbound = snap.recentMessages.filter((m) => m.direction === 'INBOUND');
  const outbound = snap.recentMessages.filter((m) => m.direction === 'OUTBOUND');
  if (inbound.length > 0 && outbound.length > 0) {
    // Most recent inbound is after the most recent outbound? Otherwise the
    // reply was before our outreach and isn't really a "reply".
    const lastIn = inbound[0]?.createdAt.getTime() ?? 0;
    const lastOut = outbound[0]?.createdAt.getTime() ?? 0;
    if (lastIn > lastOut) {
      hits.push({ rule: 'contact_replied', delta: 10, reason: 'Contact replied to outreach' });

      // Within 1h of outbound? bonus.
      if (lastIn - lastOut <= HOUR) {
        hits.push({ rule: 'fast_response_bonus', delta: 5, reason: 'Replied within 1h' });
      }
    }
  }

  // Three or more inbound messages in the last 24h.
  const since = Date.now() - DAY;
  const recentInbound = inbound.filter((m) => m.createdAt.getTime() >= since);
  if (recentInbound.length >= 3) {
    hits.push({
      rule: 'multiple_messages_24h',
      delta: 5,
      reason: `${recentInbound.length} inbound messages in 24h`,
    });
  }

  // High-value estimate.
  if ((lead.estimatedValue ?? 0) >= 50000) {
    hits.push({ rule: 'high_value_estimate', delta: 10, reason: 'Estimated value ≥ 50,000' });
  }

  // Status-based bumps. Idempotent because we only count once per status (the
  // delta is small enough that re-application during recalc is fine).
  if (lead.status === 'QUALIFIED') {
    hits.push({ rule: 'qualified_status', delta: 20, reason: 'Lead is QUALIFIED' });
  } else if (lead.status === 'PROPOSAL_SENT') {
    hits.push({ rule: 'proposal_sent_status', delta: 15, reason: 'Proposal sent' });
  } else if (lead.status === 'NEGOTIATING') {
    hits.push({ rule: 'negotiating_status', delta: 10, reason: 'In negotiation' });
  } else if (lead.status === 'DISQUALIFIED') {
    hits.push({ rule: 'disqualified_status', delta: -50, reason: 'Lead is disqualified' });
  }

  // Tag heuristics.
  if (lead.tags.includes('high-intent')) {
    hits.push({ rule: 'tag_high_intent', delta: 15, reason: 'Tagged high-intent' });
  }
  if (lead.tags.includes('cold')) {
    hits.push({ rule: 'tag_cold', delta: -10, reason: 'Tagged cold' });
  }

  // Cold decay — no recent activity in 14 days.
  const lastActivity = snap.recentMessages[0]?.createdAt.getTime() ?? lead.updatedAt.getTime();
  if (Date.now() - lastActivity > 14 * DAY) {
    hits.push({ rule: 'cold_decay', delta: -5, reason: 'No activity for 14 days' });
  }

  // Sum all deltas, clamp into [0, 100]. We compute relative to a baseline of
  // zero so the engine produces a stable score regardless of where the lead
  // started — that's safer than additive recalc, which would compound forever.
  const baseline = 0;
  const summed = hits.reduce((acc, h) => acc + h.delta, baseline);
  const newScore = Math.max(0, Math.min(100, summed));

  return { hits, newScore };
}
