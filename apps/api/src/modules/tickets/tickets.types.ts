/**
 * Shared types for the Tickets module — mirrors the entity upgrade pattern.
 */
import type {
  TicketActivityType,
  TicketPriority,
  TicketSource,
  TicketStatus,
} from '@wacrm/database';

export type TicketActor =
  | { type: 'user'; userId: string }
  | { type: 'ai' }
  | { type: 'system' }
  | { type: 'worker' }
  | { type: 'customer' };

export interface CreateTicketDto {
  title: string;
  description?: string;
  contactId?: string;
  assignedToId?: string;
  priority?: TicketPriority;
  category?: string;
  source?: TicketSource;
  tags?: string[];
  notes?: string;
  slaPolicyId?: string;
}

export interface UpdateTicketDto {
  title?: string;
  description?: string | null;
  contactId?: string | null;
  assignedToId?: string | null;
  priority?: TicketPriority;
  category?: string | null;
  tags?: string[];
  notes?: string | null;
}

export interface ListTicketsFilters {
  status?: TicketStatus | TicketStatus[];
  priority?: TicketPriority | TicketPriority[];
  source?: TicketSource | TicketSource[];
  assignedToId?: string | null;
  contactId?: string;
  category?: string;
  tag?: string;
  search?: string;
  slaBreached?: boolean;
  createdFrom?: string | Date;
  createdTo?: string | Date;
  sort?: 'recent' | 'priority' | 'updated' | 'oldest';
  page?: number;
  limit?: number;
}

export interface AddTicketActivityInput {
  type: TicketActivityType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export interface TicketStatsSnapshot {
  rangeDays: number;
  totalTickets: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  openTickets: number;
  resolvedTickets: number;
  avgFirstResponseMins: number | null;
  avgResolutionMins: number | null;
  slaBreachCount: number;
}

export interface BulkMutationResult {
  updated: number;
  failed: number;
  errors: Array<{ id: string; reason: string }>;
}
