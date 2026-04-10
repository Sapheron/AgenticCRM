/**
 * Shared types for the Deals module — DTOs, filter shapes, and the DealActor
 * tagged union used by every mutation in `DealsService` so each `DealActivity`
 * row is correctly attributed.
 */
import type {
  DealActivityType,
  DealLossReason,
  DealPriority,
  DealSource,
  DealStage,
} from '@wacrm/database';

export type DealActor =
  | { type: 'user'; userId: string }
  | { type: 'ai' }
  | { type: 'system' }
  | { type: 'whatsapp' }
  | { type: 'payment' };

export interface CreateDealDto {
  contactId?: string;
  phoneNumber?: string;
  contactName?: string;
  leadId?: string;
  title: string;
  value: number;
  currency?: string;
  stage?: DealStage;
  source?: DealSource;
  priority?: DealPriority;
  probability?: number;
  expectedCloseAt?: string | Date;
  nextActionAt?: string | Date;
  nextActionNote?: string;
  tags?: string[];
  notes?: string;
  customFields?: Record<string, unknown>;
  assignedAgentId?: string;
}

export interface UpdateDealDto {
  title?: string;
  value?: number;
  currency?: string;
  stage?: DealStage;
  source?: DealSource;
  priority?: DealPriority;
  probability?: number;
  expectedCloseAt?: string | Date | null;
  nextActionAt?: string | Date | null;
  nextActionNote?: string | null;
  tags?: string[];
  notes?: string | null;
  customFields?: Record<string, unknown>;
  assignedAgentId?: string | null;
}

export interface ListDealsFilters {
  stage?: DealStage | DealStage[];
  source?: DealSource | DealSource[];
  priority?: DealPriority | DealPriority[];
  assignedAgentId?: string | null;
  contactId?: string;
  leadId?: string;
  tag?: string;
  valueMin?: number;
  valueMax?: number;
  probabilityMin?: number;
  probabilityMax?: number;
  expectedCloseFrom?: string | Date;
  expectedCloseTo?: string | Date;
  nextActionDue?: boolean;
  search?: string;
  sort?: 'recent' | 'value' | 'probability' | 'next_action' | 'expected_close' | 'created';
  page?: number;
  limit?: number;
}

export interface MoveStageInput {
  stage: DealStage;
  lossReason?: DealLossReason;
  lossReasonText?: string;
}

export interface CreateLineItemDto {
  productId?: string;
  name: string;
  description?: string;
  quantity?: number;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
  position?: number;
}

export interface UpdateLineItemDto {
  productId?: string | null;
  name?: string;
  description?: string | null;
  quantity?: number;
  unitPrice?: number;
  discount?: number;
  taxRate?: number;
  position?: number;
}

export interface AddDealActivityInput {
  type: DealActivityType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}
