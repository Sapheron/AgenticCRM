/**
 * Shared types for the Tasks module — DTOs, filter shapes, and the TaskActor
 * tagged union used by every mutation in `TasksService` so each
 * `TaskActivity` row is correctly attributed.
 */
import type {
  TaskPriority,
  TaskRecurrenceFrequency,
  TaskSource,
  TaskStatus,
  TaskActivityType,
} from '@wacrm/database';

export type TaskActor =
  | { type: 'user'; userId: string }
  | { type: 'ai' }
  | { type: 'system' }
  | { type: 'whatsapp' }
  | { type: 'recurrence' };

export interface CreateTaskDto {
  title: string;
  description?: string;
  contactId?: string;
  phoneNumber?: string;          // alternative — auto-upserts a contact
  contactName?: string;
  dealId?: string;
  leadId?: string;
  parentTaskId?: string;         // for subtasks
  recurrenceId?: string;
  assignedAgentId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  source?: TaskSource;
  tags?: string[];
  dueAt?: string | Date;
  estimatedHours?: number;
  reminderOffsets?: number[];    // minutes before dueAt
  position?: number;
}

export interface UpdateTaskDto {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  source?: TaskSource;
  tags?: string[];
  dueAt?: string | Date | null;
  assignedAgentId?: string | null;
  estimatedHours?: number | null;
  reminderOffsets?: number[];
  position?: number;
  contactId?: string | null;
  dealId?: string | null;
  leadId?: string | null;
}

export interface ListTasksFilters {
  status?: TaskStatus | TaskStatus[];
  priority?: TaskPriority | TaskPriority[];
  source?: TaskSource | TaskSource[];
  assignedAgentId?: string | null;     // pass `null` for unassigned
  assignedToMe?: boolean;              // resolved by controller against current user
  contactId?: string;
  dealId?: string;
  leadId?: string;
  parentTaskId?: string | null;        // pass `null` for top-level only (no subtasks)
  tag?: string;
  dueFrom?: string | Date;
  dueTo?: string | Date;
  overdue?: boolean;
  search?: string;
  includeCancelled?: boolean;
  sort?: 'recent' | 'due' | 'priority' | 'created';
  page?: number;
  limit?: number;
}

export interface AddCommentDto {
  body: string;
  mentions?: string[];
}

export interface AddTaskActivityInput {
  type: TaskActivityType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateRecurrenceDto {
  templateTitle: string;
  templateBody?: string;
  templatePriority?: TaskPriority;
  templateAssignedAgentId?: string;
  frequency: TaskRecurrenceFrequency;
  intervalDays?: number;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  startsAt: string | Date;
  endsAt?: string | Date;
}
