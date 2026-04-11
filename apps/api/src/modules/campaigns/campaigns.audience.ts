/**
 * Pure audience resolver for campaigns.
 *
 * Takes a candidate contact list + a filter and returns the set of contact
 * ids that should receive the campaign, plus the count of opted-out contacts
 * that matched (so the service can either skip them silently or mark them
 * OPTED_OUT in the recipient table).
 *
 * No DB access — the caller snapshots contacts first. This makes the function
 * testable in isolation and keeps `launchCampaign` idempotent: the same
 * contact snapshot always yields the same recipient set.
 */

import type { CampaignAudienceFilter } from './campaigns.types';

export interface ContactSnap {
  id: string;
  tags: string[];
  optedOut: boolean;
  isBlocked: boolean;
}

export interface ResolvedAudience {
  /** Contact ids that should become PENDING recipients. */
  contactIds: string[];
  /** Contacts that matched the filter but were dropped due to opt-out/block. */
  optedOutContactIds: string[];
  /** Total contacts matching the raw filter (before opt-out handling). */
  totalMatch: number;
}

/**
 * Resolve an audience from a candidate contact pool.
 *
 * Matching rules:
 * - `tags` (if any) AND-joined against each contact's tags.
 * - `contactIds` (if any) force-include those contacts regardless of tag match.
 * - `isBlocked` contacts are always dropped silently.
 * - `optedOut` contacts: included in `optedOutContactIds`, handling is up to
 *   the caller based on `optOutBehavior`.
 *
 * If both `tags` and `contactIds` are empty, returns an empty audience —
 * a campaign with no audience is a DRAFT that can't launch.
 */
export function resolveAudience(
  contacts: ContactSnap[],
  filter: CampaignAudienceFilter,
): ResolvedAudience {
  const tags = filter.tags ?? [];
  const explicitIds = new Set(filter.contactIds ?? []);

  if (tags.length === 0 && explicitIds.size === 0) {
    return { contactIds: [], optedOutContactIds: [], totalMatch: 0 };
  }

  const tagMatch = (c: ContactSnap): boolean => {
    if (tags.length === 0) return false;
    return tags.every((t) => c.tags.includes(t));
  };

  const deliverable: string[] = [];
  const optedOut: string[] = [];
  const seen = new Set<string>();
  let totalMatch = 0;

  for (const c of contacts) {
    const matched = explicitIds.has(c.id) || tagMatch(c);
    if (!matched) continue;

    totalMatch++;
    if (seen.has(c.id)) continue;
    seen.add(c.id);

    if (c.isBlocked) continue; // always silently skipped
    if (c.optedOut) {
      optedOut.push(c.id);
      continue;
    }
    deliverable.push(c.id);
  }

  return {
    contactIds: deliverable,
    optedOutContactIds: optedOut,
    totalMatch,
  };
}

/**
 * Render a per-recipient body from a template by substituting `{{var}}` tokens
 * against a variables map. Unknown variables are left as-is so the template is
 * visible in the rendered text (makes bugs obvious vs silently dropping them).
 */
export function renderTemplate(
  body: string,
  variables: Record<string, string | number | null | undefined>,
): string {
  return body.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name: string) => {
    const v = variables[name];
    if (v === undefined || v === null) return match;
    return String(v);
  });
}
