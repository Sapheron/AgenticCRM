/**
 * Campaign Scheduler — runs every minute to launch due SCHEDULED campaigns.
 *
 * For each SCHEDULED campaign whose `startAt <= now`:
 *   1. Resolve the audience against the company's contacts (tag filter + explicit ids).
 *   2. Snapshot matching contacts into `CampaignRecipient` rows (PENDING status).
 *   3. Mark opted-out contacts as OPTED_OUT if `audienceOptOutBehavior === 'fail'`.
 *   4. Flip the campaign to SENDING and stamp `startedAt`.
 *
 * After this tick, the `campaign-send.processor.ts` drains PENDING recipients
 * on its own cadence (DIRECT mode) — scheduler does not send anything itself.
 *
 * Kept self-contained (no cross-app imports) by duplicating minimal launch
 * logic inline. Mirrors `sequence-execution.processor.ts` + `lead-decay.processor.ts`.
 */
import { Worker, Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { prisma } from '@wacrm/database';
import { QUEUES } from '@wacrm/shared';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

const BATCH_SIZE = 50;

export function campaignSchedulerQueue(): Queue {
  return new Queue(QUEUES.CAMPAIGN_SCHEDULER, { connection });
}

export function startCampaignSchedulerProcessor(): Worker {
  const worker = new Worker(
    QUEUES.CAMPAIGN_SCHEDULER,
    async (_job: Job) => {
      const now = new Date();
      try {
        const due = await prisma.campaign.findMany({
          where: {
            status: 'SCHEDULED',
            startAt: { lte: now },
          },
          take: BATCH_SIZE,
          orderBy: { startAt: 'asc' },
        });

        if (due.length === 0) {
          logger.debug('No campaigns due for launch');
          return;
        }

        logger.info({ count: due.length }, `Launching ${due.length} due campaigns`);

        let launched = 0;
        let failed = 0;

        for (const campaign of due) {
          try {
            await launchCampaign(campaign);
            launched++;
          } catch (err) {
            failed++;
            const msg = err instanceof Error ? err.message : String(err);
            logger.error({ campaignId: campaign.id, err: msg }, 'Failed to launch campaign');
            await prisma.campaign.update({
              where: { id: campaign.id },
              data: { status: 'FAILED', errorMessage: msg },
            });
            await prisma.campaignActivity.create({
              data: {
                campaignId: campaign.id,
                companyId: campaign.companyId,
                type: 'ERROR',
                actorType: 'worker',
                title: 'Launch failed',
                body: msg,
              },
            });
          }
        }

        logger.info({ launched, failed }, 'Campaign scheduler tick complete');
      } catch (err) {
        logger.error({ err }, 'Campaign scheduler tick errored');
      }
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Campaign scheduler job failed');
  });

  return worker;
}

/**
 * Duplicate of `CampaignsService.launch` with minimal logic — resolves audience,
 * inserts recipients, flips status. Kept in sync manually with the API service.
 */
async function launchCampaign(campaign: {
  id: string;
  companyId: string;
  name: string;
  sendMode: string;
  templateId: string | null;
  sequenceId: string | null;
  audienceTags: string[];
  audienceContactIds: string[];
  audienceOptOutBehavior: string;
}): Promise<void> {
  // Preconditions
  const hasAudience =
    campaign.audienceTags.length > 0 || campaign.audienceContactIds.length > 0;
  if (!hasAudience) {
    throw new Error('Campaign has no audience configured');
  }
  if (campaign.sendMode === 'DIRECT' && !campaign.templateId) {
    throw new Error('DIRECT campaigns require templateId');
  }
  if (campaign.sendMode === 'SEQUENCE' && !campaign.sequenceId) {
    throw new Error('SEQUENCE campaigns require sequenceId');
  }

  // Resolve audience
  const contacts = await prisma.contact.findMany({
    where: {
      companyId: campaign.companyId,
      OR: [
        { tags: { hasSome: campaign.audienceTags } },
        { id: { in: campaign.audienceContactIds } },
      ],
    },
    select: { id: true, tags: true, optedOut: true, isBlocked: true },
  });

  const explicit = new Set(campaign.audienceContactIds);
  const deliverable: string[] = [];
  const optedOut: string[] = [];
  const seen = new Set<string>();

  for (const c of contacts) {
    const tagMatch =
      campaign.audienceTags.length > 0 &&
      campaign.audienceTags.every((t) => c.tags.includes(t));
    const matched = explicit.has(c.id) || tagMatch;
    if (!matched || seen.has(c.id)) continue;
    seen.add(c.id);
    if (c.isBlocked) continue;
    if (c.optedOut) {
      optedOut.push(c.id);
      continue;
    }
    deliverable.push(c.id);
  }

  if (deliverable.length === 0 && optedOut.length === 0) {
    throw new Error('Resolved audience is empty');
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const pendingRows = deliverable.map((contactId) => ({
      campaignId: campaign.id,
      companyId: campaign.companyId,
      contactId,
      status: 'PENDING' as const,
      queuedAt: now,
    }));
    const optedOutRows =
      campaign.audienceOptOutBehavior === 'fail'
        ? optedOut.map((contactId) => ({
            campaignId: campaign.id,
            companyId: campaign.companyId,
            contactId,
            status: 'OPTED_OUT' as const,
            queuedAt: now,
          }))
        : [];

    if (pendingRows.length > 0 || optedOutRows.length > 0) {
      await tx.campaignRecipient.createMany({
        data: [...pendingRows, ...optedOutRows],
        skipDuplicates: true,
      });
    }

    await tx.campaign.update({
      where: { id: campaign.id },
      data: {
        status: 'SENDING',
        startedAt: now,
        totalRecipients: pendingRows.length + optedOutRows.length,
        optedOutCount: optedOutRows.length,
      },
    });
  });

  await prisma.campaignActivity.create({
    data: {
      campaignId: campaign.id,
      companyId: campaign.companyId,
      type: 'LAUNCHED',
      actorType: 'worker',
      title: `Auto-launched — ${deliverable.length} recipients queued`,
      body:
        optedOut.length > 0
          ? `${optedOut.length} opted-out contacts ${
              campaign.audienceOptOutBehavior === 'fail' ? 'marked OPTED_OUT' : 'silently skipped'
            }`
          : undefined,
      metadata: {
        sendMode: campaign.sendMode,
        deliverable: deliverable.length,
        optedOut: optedOut.length,
      },
    },
  });
}
