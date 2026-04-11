/**
 * Shared types for the Campaigns module — DTOs, filter shapes, and the
 * CampaignActor tagged union used by every mutation in `CampaignsService`
 * so each `CampaignActivity` row can be attributed back to the original
 * user / AI / system / worker source.
 */
import type {
  CampaignActivityType,
  CampaignChannel,
  CampaignRecipientStatus,
  CampaignSendMode,
  CampaignStatus,
} from '@wacrm/database';

export type CampaignActor =
  | { type: 'user'; userId: string }
  | { type: 'ai' }
  | { type: 'system' }
  | { type: 'worker' };

/** Audience filter — applied on launch to snapshot into CampaignRecipient rows. */
export interface CampaignAudienceFilter {
  /** AND-joined against Contact.tags. */
  tags?: string[];
  /** Explicit adds — merged with the tag match. */
  contactIds?: string[];
  /** "skip" (default) silently drops opted-out contacts; "fail" marks them OPTED_OUT in the recipient table. */
  optOutBehavior?: 'skip' | 'fail';
}

export interface CreateCampaignDto {
  name: string;
  description?: string;
  channel?: CampaignChannel;
  sendMode?: CampaignSendMode;
  templateId?: string;
  sequenceId?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  tags?: string[];
  budget?: number;
  throttleMs?: number;
  notes?: string;
  audience?: CampaignAudienceFilter;
}

export interface UpdateCampaignDto {
  name?: string;
  description?: string | null;
  channel?: CampaignChannel;
  sendMode?: CampaignSendMode;
  templateId?: string | null;
  sequenceId?: string | null;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  tags?: string[];
  budget?: number | null;
  throttleMs?: number;
  notes?: string | null;
}

export interface ListCampaignsFilters {
  status?: CampaignStatus | CampaignStatus[];
  channel?: CampaignChannel | CampaignChannel[];
  sendMode?: CampaignSendMode | CampaignSendMode[];
  priority?: string | string[];
  tag?: string;
  /** Free-text search over name, description, notes. */
  search?: string;
  /** Only return campaigns scheduled to start on/after this time. */
  startFrom?: string | Date;
  startTo?: string | Date;
  createdFrom?: string | Date;
  createdTo?: string | Date;
  sort?: 'recent' | 'scheduled' | 'name' | 'progress';
  page?: number;
  limit?: number;
}

export interface ListRecipientsFilters {
  status?: CampaignRecipientStatus | CampaignRecipientStatus[];
  page?: number;
  limit?: number;
}

export interface ScheduleCampaignDto {
  startAt: string | Date;
}

export interface CancelCampaignDto {
  reason?: string;
}

export interface AddCampaignActivityInput {
  type: CampaignActivityType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export interface CampaignStatsSnapshot {
  rangeDays: number;
  totalCampaigns: number;
  byStatus: Record<string, number>;
  activeCampaigns: number;
  scheduledCampaigns: number;
  completedCampaigns: number;
  /** Sum of sentCount across all campaigns in the range. */
  totalSent: number;
  totalDelivered: number;
  totalReplied: number;
  totalFailed: number;
  /** replied / sent — a percentage 0..100, or null when no sends yet. */
  replyRate: number | null;
  /** delivered / sent — a percentage 0..100, or null. */
  deliveryRate: number | null;
}

export interface AudiencePreview {
  totalMatch: number;
  optedOut: number;
  netDeliverable: number;
  sampleContacts: Array<{
    id: string;
    displayName?: string | null;
    phoneNumber: string;
  }>;
}

export interface BulkMutationResult {
  updated: number;
  failed: number;
  errors: Array<{ id: string; reason: string }>;
}
