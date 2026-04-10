/**
 * Shared types for the Leads module — DTOs, filter shapes, and the LeadActor
 * tagged union used by every mutation in `LeadsService` so we can attribute
 * each `LeadActivity` row to a user / AI / system source.
 */
import type { LeadActivityType, LeadPriority, LeadSource, LeadStatus } from '@wacrm/database';

export type LeadActor =
  | { type: 'user'; userId: string }
  | { type: 'ai' }
  | { type: 'system' }
  | { type: 'whatsapp' };

export interface CreateLeadDto {
  contactId?: string;
  phoneNumber?: string;          // alternative to contactId — upserts contact
  contactName?: string;          // optional display name when upserting
  title: string;
  status?: LeadStatus;
  source?: LeadSource;
  priority?: LeadPriority;
  score?: number;
  probability?: number;
  estimatedValue?: number;
  currency?: string;
  tags?: string[];
  notes?: string;
  expectedCloseAt?: string | Date;
  nextActionAt?: string | Date;
  nextActionNote?: string;
  customFields?: Record<string, unknown>;
  assignedAgentId?: string;
  /** When true, bypass duplicate detection (open lead exists for the contact in the last 30 days). */
  force?: boolean;
}

export interface UpdateLeadDto {
  title?: string;
  status?: LeadStatus;
  source?: LeadSource;
  priority?: LeadPriority;
  probability?: number;
  estimatedValue?: number;
  currency?: string;
  tags?: string[];
  notes?: string;
  expectedCloseAt?: string | Date | null;
  nextActionAt?: string | Date | null;
  nextActionNote?: string | null;
  customFields?: Record<string, unknown>;
  assignedAgentId?: string | null;
}

export interface ListLeadsFilters {
  status?: LeadStatus | LeadStatus[];
  source?: LeadSource | LeadSource[];
  priority?: LeadPriority | LeadPriority[];
  assignedAgentId?: string | null;  // pass `null` for unassigned
  contactId?: string;
  tag?: string;
  scoreMin?: number;
  scoreMax?: number;
  valueMin?: number;
  valueMax?: number;
  createdFrom?: string | Date;
  createdTo?: string | Date;
  /** When true, only return leads whose `nextActionAt` is in the past. */
  nextActionDue?: boolean;
  /** Free-text search over title, notes, and contact name/phone. */
  search?: string;
  sort?: 'recent' | 'score' | 'value' | 'next_action' | 'created';
  page?: number;
  limit?: number;
}

export interface ConvertLeadDto {
  dealTitle?: string;
  value?: number;
  currency?: string;
  stage?: 'LEAD_IN' | 'QUALIFIED' | 'PROPOSAL' | 'NEGOTIATION' | 'WON' | 'LOST';
  probability?: number;
  expectedCloseAt?: string | Date;
}

export interface AddActivityInput {
  type: LeadActivityType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}
