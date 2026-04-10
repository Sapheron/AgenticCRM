/**
 * Shared types for the Broadcasts module — DTOs, audience filter shape,
 * and the BroadcastActor tagged union used by every mutation in
 * `BroadcastService` so each `BroadcastActivity` row is correctly attributed.
 */
import type { BroadcastActivityType, BroadcastStatus } from '@wacrm/database';

export type BroadcastActor =
  | { type: 'user'; userId: string }
  | { type: 'ai' }
  | { type: 'system' }
  | { type: 'worker' };

/**
 * Audience filter — matches the structure of `ContactsService.list` filters
 * but typed for use inside a broadcast. Stored as JSON on the broadcast row
 * and re-resolved when `setAudience` is called.
 */
export interface AudienceFilter {
  tags?: string[];
  contactIds?: string[];
  lifecycleStage?: string;
  scoreMin?: number;
  scoreMax?: number;
  hasOpenDeal?: boolean;
  hasOpenLead?: boolean;
  customFieldEquals?: Record<string, string>;
}

export interface CreateBroadcastDto {
  name: string;
  message: string;
  mediaUrl?: string;
  mediaType?: string;
  mediaCaption?: string;
  templateName?: string;
  variables?: Record<string, string>;
  /** Optional audience filter to apply on creation. */
  audience?: AudienceFilter;
  /** Optional schedule on creation. If set, broadcast goes straight to SCHEDULED. */
  scheduledAt?: string | Date;
  throttleMs?: number;
}

export interface UpdateBroadcastDto {
  name?: string;
  message?: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  mediaCaption?: string | null;
  templateName?: string | null;
  variables?: Record<string, string>;
  throttleMs?: number;
}

export interface ListBroadcastsFilters {
  status?: BroadcastStatus | BroadcastStatus[];
  search?: string;
  scheduledFrom?: string | Date;
  scheduledTo?: string | Date;
  sort?: 'recent' | 'scheduled' | 'sent_count' | 'name';
  page?: number;
  limit?: number;
}

export interface AddBroadcastActivityInput {
  type: BroadcastActivityType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}
