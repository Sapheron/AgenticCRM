/**
 * Sequences module types — DTOs, actors, and interfaces.
 *
 * Mirrors the entity upgrade pattern with single-write-path service,
 * activity timeline, and full AI control.
 */
import type { SequenceStatus, SequenceActivityType, EnrollmentActivityType } from '@wacrm/database';

export type SequenceActor =
  | { type: 'user'; userId: string }
  | { type: 'ai' }
  | { type: 'system' }
  | { type: 'worker' };

export interface CreateSequenceDto {
  name: string;
  description?: string;
  tags?: string[];
  steps?: CreateStepDto[];
}

export interface UpdateSequenceDto {
  name?: string;
  description?: string;
  tags?: string[];
}

export interface CreateStepDto {
  sortOrder?: number;
  delayHours: number;
  action: string;
  message?: string;
  templateId?: string;
  subject?: string;
  tagName?: string;
  webhookUrl?: string;
  condition?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateStepDto {
  delayHours?: number;
  action?: string;
  message?: string;
  templateId?: string;
  subject?: string;
  tagName?: string;
  webhookUrl?: string;
  condition?: string;
  metadata?: Record<string, unknown>;
}

export interface EnrollContactDto {
  contactId?: string;
  phoneNumber?: string;
  startAt?: Date;
}

export interface ListSequencesFilters {
  status?: SequenceStatus;
  search?: string;
  tags?: string[];
  sort?: 'recent' | 'used' | 'name' | 'completion';
  page?: number;
  limit?: number;
}

export interface SequenceStats {
  totalSequences: number;
  activeSequences: number;
  totalEnrollments: number;
  activeEnrollments: number;
  overallCompletionRate: number;
  topSequences: Array<{
    id: string;
    name: string;
    enrollments: number;
    completions: number;
    rate: number;
  }>;
}

export interface SequencePerformance {
  sequenceId: string;
  totalEnrollments: number;
  completed: number;
  stopped: number;
  inProgress: number;
  completionRate: number;
  avgCompletionHours: number;
  dropOffPerStep: Array<{
    stepNumber: number;
    enrolled: number;
    completed: number;
    dropped: number;
    dropOffRate: number;
  }>;
}

export interface AddSequenceActivityInput {
  type: SequenceActivityType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export interface AddEnrollmentActivityInput {
  type: EnrollmentActivityType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}
