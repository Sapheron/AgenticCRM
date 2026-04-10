/**
 * Audience filter resolver.
 *
 * Translates an `AudienceFilter` shape into a Prisma `where` clause for the
 * `Contact` model. Default exclusions: opted-out, blocked, soft-deleted,
 * and contacts without a phone number (we can't WhatsApp them).
 *
 * Same shape as the filter used by `ContactsService.list`, so the same
 * mental model applies.
 */
import { prisma } from '@wacrm/database';
import type { Prisma } from '@wacrm/database';
import type { AudienceFilter } from './broadcast.types';

export function buildAudienceWhere(
  companyId: string,
  filter: AudienceFilter | null | undefined,
): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = {
    companyId,
    deletedAt: null,
    optedOut: false,
    isBlocked: false,
    NOT: { phoneNumber: '' },
  };

  if (!filter) return where;

  if (filter.contactIds?.length) {
    where.id = { in: filter.contactIds };
  }

  if (filter.tags?.length) {
    where.tags = { hasSome: filter.tags };
  }

  if (filter.lifecycleStage) {
    where.lifecycleStage = filter.lifecycleStage;
  }

  if (filter.scoreMin !== undefined || filter.scoreMax !== undefined) {
    where.score = {};
    if (filter.scoreMin !== undefined) where.score.gte = filter.scoreMin;
    if (filter.scoreMax !== undefined) where.score.lte = filter.scoreMax;
  }

  // hasOpenDeal / hasOpenLead — quantitative existence checks
  const andClauses: Prisma.ContactWhereInput[] = [];
  if (filter.hasOpenDeal) {
    andClauses.push({
      deals: {
        some: { deletedAt: null, stage: { notIn: ['WON', 'LOST'] } },
      },
    });
  }
  if (filter.hasOpenLead) {
    andClauses.push({
      leads: {
        some: { deletedAt: null, status: { notIn: ['WON', 'LOST', 'DISQUALIFIED'] } },
      },
    });
  }
  if (andClauses.length > 0) where.AND = andClauses;

  return where;
}

/**
 * Live-resolve an audience filter into a list of contacts. Used by
 * `BroadcastsService.setAudience()` to snapshot recipients into the
 * `BroadcastRecipient` table.
 *
 * Capped at 100,000 contacts per broadcast to prevent runaway queries.
 */
export async function resolveAudience(
  companyId: string,
  filter: AudienceFilter | null | undefined,
) {
  const where = buildAudienceWhere(companyId, filter);
  return prisma.contact.findMany({
    where,
    take: 100_000,
    select: {
      id: true,
      phoneNumber: true,
      firstName: true,
      lastName: true,
      displayName: true,
      email: true,
      companyName: true,
      customFields: true,
    },
    orderBy: { id: 'asc' },
  });
}

/**
 * Count-only variant for the AI's `preview_audience_size` tool. Same filter,
 * just doesn't fetch the rows.
 */
export async function countAudience(
  companyId: string,
  filter: AudienceFilter | null | undefined,
): Promise<number> {
  const where = buildAudienceWhere(companyId, filter);
  return prisma.contact.count({ where });
}
