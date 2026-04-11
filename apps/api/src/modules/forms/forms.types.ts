/**
 * Shared types for the Forms module — DTOs, filter shapes, the FormActor
 * tagged union used by every mutation in `FormsService`, and the strongly
 * typed `FormField` shape that lives inside the `Form.fields` JSON column.
 *
 * FormField shape mirrors the OpenClaw Discord modal field schema
 * (extensions/discord/src/message-tool-schema.ts) for consistency.
 */
import type {
  FormActivityType,
  FormStatus,
  FormSubmissionStatus,
} from '@wacrm/database';

export type FormActor =
  | { type: 'user'; userId: string }
  | { type: 'ai' }
  | { type: 'system' }
  | { type: 'worker' }
  | { type: 'public' };

export type FormFieldType =
  | 'text'
  | 'email'
  | 'phone'
  | 'number'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'url';

/**
 * Strongly-typed field definition stored in `Form.fields` (Json).
 *
 * `key` is the stable identifier used in the submission payload — do not
 * change it once a form has submissions unless you also migrate the data.
 */
export interface FormField {
  key: string;
  type: FormFieldType;
  label: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  /** For `select` and `radio` types. */
  options?: Array<{ value: string; label: string }>;
  /** Text / textarea length constraints. */
  minLength?: number;
  maxLength?: number;
  /** Number / date range. For date, use ISO-8601 strings. */
  min?: number | string;
  max?: number | string;
  defaultValue?: string | number | boolean;
  /** Optional regex-based validation (server-enforced). */
  validation?: {
    pattern?: string;
    errorMessage?: string;
  };
}

// ── DTOs ─────────────────────────────────────────────────────────────────

export interface CreateFormDto {
  name: string;
  description?: string;
  /** Initial field list — typically 0 and the caller adds them via addField. */
  fields?: FormField[];
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  tags?: string[];
  notes?: string;
}

export interface UpdateFormDto {
  name?: string;
  description?: string | null;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  tags?: string[];
  notes?: string | null;
  isPublic?: boolean;
  requireCaptcha?: boolean;
  rateLimitPerHour?: number;
}

export interface AutoActionsConfig {
  autoCreateLead?: boolean;
  autoLeadSource?: string | null;
  autoLeadTitle?: string | null;
  autoEnrollSequenceId?: string | null;
  autoAssignUserId?: string | null;
  autoTagContact?: string[];
  webhookForwardUrl?: string | null;
}

/** Payload that enters `FormsService.submit()` — always a flat key→value map. */
export type SubmissionPayload = Record<string, unknown>;

/** Per-request metadata captured by the controllers before calling submit. */
export interface SubmissionMeta {
  actor: FormActor;
  ipAddress?: string;
  userAgent?: string;
  referrer?: string;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
  };
}

export interface ListFormsFilters {
  status?: FormStatus | FormStatus[];
  tag?: string;
  search?: string;
  createdFrom?: string | Date;
  createdTo?: string | Date;
  sort?: 'recent' | 'name' | 'submissions' | 'conversion';
  page?: number;
  limit?: number;
}

export interface ListSubmissionsFilters {
  status?: FormSubmissionStatus | FormSubmissionStatus[];
  search?: string;
  page?: number;
  limit?: number;
}

export interface AddFormActivityInput {
  type: FormActivityType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

// ── Result shapes ─────────────────────────────────────────────────────────

export interface FormStatsSnapshot {
  rangeDays: number;
  totalForms: number;
  byStatus: Record<string, number>;
  activeForms: number;
  totalSubmissions: number;
  totalConverted: number;
  totalSpam: number;
  /** converted / submissions — percentage 0..100, or null when no submissions yet. */
  conversionRate: number | null;
  /** spam / submissions — percentage 0..100, or null. */
  spamRate: number | null;
}

export interface SubmitResult {
  submissionId: string;
  status: FormSubmissionStatus;
  leadId?: string;
  contactId?: string;
  validationErrors?: Record<string, string>;
}

export interface PublicFormDefinition {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  fields: FormField[];
  requireCaptcha: boolean;
}

export interface BulkMutationResult {
  updated: number;
  failed: number;
  errors: Array<{ id: string; reason: string }>;
}
