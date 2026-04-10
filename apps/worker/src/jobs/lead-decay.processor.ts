/**
 * Lead Decay processor — runs daily at 03:00.
 *
 * For every active (non-WON/LOST/DISQUALIFIED) lead with no recent activity
 * we re-run the same scoring logic the API uses, in-process. The decay rule
 * (`cold_decay`) inside `applyScoringRules` will fire if the most recent
 * message is older than 14 days, lowering the score and writing a
 * `LeadScoreEvent` row so the change is visible in the timeline.
 *
 * We keep this self-contained (no cross-app imports) by duplicating the
 * tiny scoring helper inline. Same pattern as `memory-dreaming.processor.ts`.
 */
import { Worker, Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { prisma } from '@wacrm/database';
import { QUEUES } from '@wacrm/shared';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const BATCH_SIZE = 200;

interface ScoreHit { rule: string; delta: number; reason: string }

function scoreLead(
  lead: { score: number; status: string; tags: string[]; estimatedValue: number | null; updatedAt: Date },
  recentMessages: { direction: string; createdAt: Date }[],
): { hits: ScoreHit[]; newScore: number } {
  const hits: ScoreHit[] = [];
  if (lead.score === 0) hits.push({ rule: 'new_lead', delta: 5, reason: 'New lead' });

  const inbound = recentMessages.filter((m) => m.direction === 'INBOUND');
  const outbound = recentMessages.filter((m) => m.direction === 'OUTBOUND');
  if (inbound.length && outbound.length) {
    const lastIn = inbound[0]?.createdAt.getTime() ?? 0;
    const lastOut = outbound[0]?.createdAt.getTime() ?? 0;
    if (lastIn > lastOut) {
      hits.push({ rule: 'contact_replied', delta: 10, reason: 'Contact replied' });
      if (lastIn - lastOut <= HOUR) hits.push({ rule: 'fast_response_bonus', delta: 5, reason: 'Replied within 1h' });
    }
  }
  const since = Date.now() - DAY;
  const recentInbound = inbound.filter((m) => m.createdAt.getTime() >= since);
  if (recentInbound.length >= 3) hits.push({ rule: 'multiple_messages_24h', delta: 5, reason: `${recentInbound.length} msgs/24h` });

  if ((lead.estimatedValue ?? 0) >= 50000) hits.push({ rule: 'high_value_estimate', delta: 10, reason: 'Value ≥ 50k' });

  if (lead.status === 'QUALIFIED') hits.push({ rule: 'qualified_status', delta: 20, reason: 'Qualified' });
  else if (lead.status === 'PROPOSAL_SENT') hits.push({ rule: 'proposal_sent_status', delta: 15, reason: 'Proposal sent' });
  else if (lead.status === 'NEGOTIATING') hits.push({ rule: 'negotiating_status', delta: 10, reason: 'Negotiating' });
  else if (lead.status === 'DISQUALIFIED') hits.push({ rule: 'disqualified_status', delta: -50, reason: 'Disqualified' });

  if (lead.tags.includes('high-intent')) hits.push({ rule: 'tag_high_intent', delta: 15, reason: 'Tagged high-intent' });
  if (lead.tags.includes('cold')) hits.push({ rule: 'tag_cold', delta: -10, reason: 'Tagged cold' });

  const lastActivity = recentMessages[0]?.createdAt.getTime() ?? lead.updatedAt.getTime();
  if (Date.now() - lastActivity > 14 * DAY) hits.push({ rule: 'cold_decay', delta: -5, reason: 'No activity 14d' });

  const summed = hits.reduce((a, h) => a + h.delta, 0);
  return { hits, newScore: Math.max(0, Math.min(100, summed)) };
}

async function runDecay(): Promise<{ scanned: number; updated: number }> {
  // Only consider open leads (not WON/LOST/DISQUALIFIED) with no recent updates.
  const cutoff = new Date(Date.now() - 7 * DAY);
  const leads = await prisma.lead.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ['WON', 'LOST', 'DISQUALIFIED'] },
      updatedAt: { lt: cutoff },
    },
    take: BATCH_SIZE,
    orderBy: { updatedAt: 'asc' },
    select: {
      id: true,
      companyId: true,
      contactId: true,
      score: true,
      status: true,
      tags: true,
      estimatedValue: true,
      updatedAt: true,
    },
  });

  let updated = 0;
  for (const lead of leads) {
    const recentMessages = await prisma.message.findMany({
      where: { companyId: lead.companyId, conversation: { contactId: lead.contactId } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { direction: true, createdAt: true },
    });

    const { hits, newScore } = scoreLead(lead, recentMessages);
    if (newScore === lead.score) continue;

    await prisma.lead.update({ where: { id: lead.id }, data: { score: newScore } });
    await prisma.leadScoreEvent.create({
      data: {
        leadId: lead.id,
        companyId: lead.companyId,
        delta: newScore - lead.score,
        newScore,
        reason: hits.length
          ? hits.map((h) => `${h.rule}: ${h.delta > 0 ? '+' : ''}${h.delta}`).join(', ')
          : 'decay',
        source: 'auto',
      },
    });
    await prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        companyId: lead.companyId,
        type: 'SCORED',
        actorType: 'system',
        title: `Score → ${newScore} (decay)`,
        body: hits.map((h) => h.reason).join('; '),
        metadata: { delta: newScore - lead.score, newScore, source: 'auto' },
      },
    });
    updated++;
  }

  return { scanned: leads.length, updated };
}

export function startLeadDecayProcessor(): Worker {
  const worker = new Worker(
    QUEUES.LEAD_DECAY,
    async (_job: Job) => {
      const result = await runDecay();
      logger.info(result, 'Lead decay complete');
      return result;
    },
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'lead decay failed'));
  logger.info('Lead decay processor started');
  return worker;
}

export function leadDecayQueue(): Queue {
  return new Queue(QUEUES.LEAD_DECAY, {
    connection: new Redis((process.env.REDIS_URL || '').trim(), { maxRetriesPerRequest: null }),
  });
}
