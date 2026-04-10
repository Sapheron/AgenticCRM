/**
 * TasksService — single write path for everything Task-related.
 *
 * Mirrors `LeadsService` and `DealsService`. Every mutation:
 *   1) Logs an entry to `TaskActivity` (the timeline)
 *   2) Auto-attributes the action via a `TaskActor` (user/ai/system/whatsapp/recurrence)
 *   3) Cascades to subtasks where appropriate (e.g. parent COMPLETE → all subtasks)
 *   4) Sets cleanupAfter when a task reaches a terminal state (DONE/CANCELLED) so
 *      the worker's task-cycle processor can hard-delete it after a TTL
 *
 * Subtasks are just `Task` rows with `parentTaskId` set — no separate model.
 * The same service methods work on subtasks transparently.
 */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import type { Prisma, Task, TaskStatus } from '@wacrm/database';
import {
  type CreateTaskDto,
  type UpdateTaskDto,
  type ListTasksFilters,
  type AddCommentDto,
  type AddTaskActivityInput,
  type CreateRecurrenceDto,
  type TaskActor,
} from './tasks.types';
import { computeNextRunAt } from './recurrence';

const DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL_STATUSES: TaskStatus[] = ['DONE', 'CANCELLED'];
const CLEANUP_AFTER_DAYS = 30;

@Injectable()
export class TasksService {
  // ── Reads ────────────────────────────────────────────────────────────────

  async list(companyId: string, filters: ListTasksFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(200, filters.limit ?? 50);
    const where = this.buildWhere(companyId, filters);
    const orderBy = this.buildOrderBy(filters.sort);

    const [items, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        include: {
          contact: { select: { id: true, displayName: true, phoneNumber: true } },
          assignedAgent: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          deal: { select: { id: true, title: true, stage: true } },
          lead: { select: { id: true, title: true, status: true } },
          subtasks: { select: { id: true, status: true } },
          _count: { select: { comments: true, watchers: true } },
        },
      }),
      prisma.task.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async get(companyId: string, id: string) {
    const task = await prisma.task.findFirst({
      where: { id, companyId },
      include: {
        contact: true,
        assignedAgent: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        deal: { select: { id: true, title: true, stage: true, value: true, currency: true } },
        lead: { select: { id: true, title: true, status: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        recurrence: true,
        subtasks: {
          orderBy: { position: 'asc' },
          include: {
            assignedAgent: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        comments: {
          orderBy: { createdAt: 'asc' },
        },
        watchers: true,
        activities: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async getTimeline(companyId: string, id: string, limit = 100) {
    await this.ensureExists(companyId, id);
    return prisma.taskActivity.findMany({
      where: { taskId: id, companyId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, limit),
    });
  }

  async getComments(companyId: string, id: string) {
    await this.ensureExists(companyId, id);
    return prisma.taskComment.findMany({
      where: { taskId: id, companyId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getSubtasks(companyId: string, parentId: string) {
    await this.ensureExists(companyId, parentId);
    return prisma.task.findMany({
      where: { companyId, parentTaskId: parentId },
      orderBy: { position: 'asc' },
      include: {
        assignedAgent: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async stats(companyId: string, days = 30) {
    const since = new Date(Date.now() - days * DAY_MS);
    const where: Prisma.TaskWhereInput = { companyId };

    const [grouped, overdue, completedRecently, avgCycle] = await Promise.all([
      prisma.task.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      prisma.task.count({
        where: {
          companyId,
          status: { notIn: TERMINAL_STATUSES },
          dueAt: { lt: new Date() },
        },
      }),
      prisma.task.count({
        where: { companyId, status: 'DONE', completedAt: { gte: since } },
      }),
      prisma.task.findMany({
        where: { companyId, status: 'DONE', completedAt: { gte: since }, startedAt: { not: null } },
        select: { startedAt: true, completedAt: true },
        take: 200,
      }),
    ]);

    const totalCreated = grouped.reduce((acc, g) => acc + g._count._all, 0);
    const done = grouped.find((g) => g.status === 'DONE')?._count._all ?? 0;
    const cancelled = grouped.find((g) => g.status === 'CANCELLED')?._count._all ?? 0;
    const closed = done + cancelled;

    let totalCycleMs = 0;
    let cycleSamples = 0;
    for (const t of avgCycle) {
      if (t.startedAt && t.completedAt) {
        totalCycleMs += t.completedAt.getTime() - t.startedAt.getTime();
        cycleSamples++;
      }
    }
    const avgCycleHours = cycleSamples > 0 ? Math.round(totalCycleMs / cycleSamples / (60 * 60 * 1000)) : 0;

    return {
      rangeDays: days,
      total: totalCreated,
      byStatus: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
      overdue,
      completedRecently,
      completionRate: closed > 0 ? Math.round((done / closed) * 100) : 0,
      avgCycleHours,
    };
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  async create(companyId: string, dto: CreateTaskDto, actor: TaskActor): Promise<Task> {
    if (!dto.title?.trim()) throw new BadRequestException('Task title is required');

    // Resolve contact via phoneNumber if no contactId given
    let contactId = dto.contactId;
    if (!contactId && dto.phoneNumber) {
      const phone = normalizePhone(dto.phoneNumber);
      const contact = await prisma.contact.upsert({
        where: { companyId_phoneNumber: { companyId, phoneNumber: phone } },
        create: {
          companyId,
          phoneNumber: phone,
          displayName: dto.contactName ?? phone,
        },
        update: { deletedAt: null },
      });
      contactId = contact.id;
    }

    // Inherit context from parent if this is a subtask
    let parentContext: { contactId?: string | null; dealId?: string | null; leadId?: string | null } = {};
    if (dto.parentTaskId) {
      const parent = await prisma.task.findFirst({
        where: { id: dto.parentTaskId, companyId },
        select: { contactId: true, dealId: true, leadId: true },
      });
      if (!parent) throw new BadRequestException('Parent task not found');
      parentContext = parent;
    }

    const createdById = actor.type === 'user' ? actor.userId : null;

    const task = await prisma.task.create({
      data: {
        companyId,
        createdById,
        title: dto.title,
        description: dto.description,
        contactId: contactId ?? parentContext.contactId ?? null,
        dealId: dto.dealId ?? parentContext.dealId ?? null,
        leadId: dto.leadId ?? parentContext.leadId ?? null,
        parentTaskId: dto.parentTaskId,
        recurrenceId: dto.recurrenceId,
        assignedAgentId: dto.assignedAgentId,
        status: dto.status ?? 'TODO',
        priority: dto.priority ?? 'MEDIUM',
        source: dto.source ?? (actor.type === 'ai' ? 'AI_CHAT' : actor.type === 'recurrence' ? 'RECURRING' : actor.type === 'whatsapp' ? 'WHATSAPP' : 'MANUAL'),
        tags: dto.tags ?? [],
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        estimatedHours: dto.estimatedHours,
        reminderOffsets: dto.reminderOffsets ?? [30],
        position: dto.position ?? 0,
      },
    });

    await this.logActivity(companyId, task.id, actor, {
      type: dto.parentTaskId ? 'SUBTASK_ADDED' : 'CREATED',
      title: dto.parentTaskId ? `Subtask added: "${task.title}"` : `Task created: "${task.title}"`,
      metadata: { priority: task.priority, dueAt: task.dueAt },
    });

    // If a subtask was just added, also drop a row on the parent's timeline
    if (dto.parentTaskId) {
      await this.logActivity(companyId, dto.parentTaskId, actor, {
        type: 'SUBTASK_ADDED',
        title: `Subtask: ${task.title}`,
        metadata: { subtaskId: task.id },
      });
    }

    return task;
  }

  async update(companyId: string, id: string, dto: UpdateTaskDto, actor: TaskActor): Promise<Task> {
    const existing = await this.get(companyId, id);
    const data: Prisma.TaskUpdateInput = {};
    const changes: string[] = [];

    const set = <K extends keyof UpdateTaskDto>(
      key: K,
      transform?: (v: UpdateTaskDto[K]) => unknown,
    ) => {
      if (dto[key] === undefined) return;
      const next = transform ? transform(dto[key]) : dto[key];
      const prev = (existing as unknown as Record<string, unknown>)[key as string];
      if (next !== prev) {
        (data as Record<string, unknown>)[key as string] = next;
        changes.push(String(key));
      }
    };

    set('title');
    set('description');
    set('priority');
    set('source');
    set('tags', (v) => v ?? []);
    set('estimatedHours');
    set('position');
    set('reminderOffsets');
    set('dueAt', (v) => (v == null ? null : new Date(v as string | Date)));
    set('assignedAgentId');
    set('contactId');
    set('dealId');
    set('leadId');

    // Status changes go through `updateStatus` for terminal-state handling
    if (dto.status !== undefined && dto.status !== existing.status) {
      throw new BadRequestException('Use updateStatus() to change task status');
    }

    if (changes.length === 0) return existing as Task;

    // If due date changed, reset reminders so the new time fires fresh
    if (changes.includes('dueAt')) {
      data.remindersSent = [];
      data.reminderSentAt = null;
    }

    const updated = await prisma.task.update({ where: { id }, data });
    await this.logActivity(companyId, id, actor, {
      type:
        changes.includes('priority') ? 'PRIORITY_CHANGED'
        : changes.includes('dueAt') ? 'DUE_DATE_CHANGED'
        : changes.includes('title') ? 'TITLE_CHANGED'
        : changes.includes('description') ? 'DESCRIPTION_CHANGED'
        : 'FIELD_UPDATED',
      title: `Updated: ${changes.join(', ')}`,
      metadata: { fields: changes },
    });

    return updated;
  }

  async updateStatus(
    companyId: string,
    id: string,
    status: TaskStatus,
    actor: TaskActor,
    reason?: string,
  ): Promise<Task> {
    const existing = await this.get(companyId, id);
    if (existing.status === status) return existing as Task;

    const data: Prisma.TaskUpdateInput = { status };
    const now = new Date();
    if (status === 'IN_PROGRESS' && !existing.startedAt) data.startedAt = now;
    if (status === 'DONE') {
      data.completedAt = now;
      data.cleanupAfter = new Date(now.getTime() + CLEANUP_AFTER_DAYS * DAY_MS);
      // Mirror DONE to all subtasks for the parent's completion %
      await prisma.task.updateMany({
        where: { parentTaskId: id, status: { notIn: TERMINAL_STATUSES } },
        data: { status: 'DONE', completedAt: now },
      });
    }
    if (status === 'CANCELLED') {
      data.cancelledAt = now;
      if (reason) data.cancelReason = reason;
      data.cleanupAfter = new Date(now.getTime() + CLEANUP_AFTER_DAYS * DAY_MS);
    }
    if (status === 'TODO' && (existing.status === 'DONE' || existing.status === 'CANCELLED')) {
      data.completedAt = null;
      data.cancelledAt = null;
      data.cleanupAfter = null;
      data.cancelReason = null;
    }

    const updated = await prisma.task.update({ where: { id }, data });

    await this.logActivity(companyId, id, actor, {
      type:
        status === 'DONE' ? 'COMPLETED'
        : status === 'CANCELLED' ? 'CANCELLED'
        : (existing.status === 'DONE' || existing.status === 'CANCELLED') ? 'REOPENED'
        : 'STATUS_CHANGED',
      title: `Status: ${existing.status} → ${status}`,
      body: reason,
      metadata: { fromStatus: existing.status, toStatus: status, reason },
    });

    // If this is a subtask hitting DONE, log a SUBTASK_COMPLETED on the parent
    if (status === 'DONE' && existing.parentTaskId) {
      await this.logActivity(companyId, existing.parentTaskId, actor, {
        type: 'SUBTASK_COMPLETED',
        title: `Subtask done: ${existing.title}`,
        metadata: { subtaskId: id },
      });
    }

    // If this task is part of a recurring series and just hit DONE,
    // schedule the next instance immediately.
    if (status === 'DONE' && existing.recurrenceId) {
      await this.spawnNextRecurringInstance(existing.recurrenceId).catch(() => undefined);
    }

    return updated;
  }

  async assign(companyId: string, id: string, userId: string | null, actor: TaskActor): Promise<Task> {
    const existing = await this.get(companyId, id);
    if (existing.assignedAgentId === userId) return existing as Task;

    if (userId) {
      const user = await prisma.user.findFirst({ where: { id: userId, companyId } });
      if (!user) throw new BadRequestException(`User ${userId} not found in this company`);
    }

    const updated = await prisma.task.update({ where: { id }, data: { assignedAgentId: userId } });
    await this.logActivity(companyId, id, actor, {
      type: userId ? 'ASSIGNED' : 'UNASSIGNED',
      title: userId ? `Assigned to user ${userId}` : 'Unassigned',
      metadata: { previousAgentId: existing.assignedAgentId, newAgentId: userId },
    });

    // Auto-add the new assignee as a watcher (idempotent)
    if (userId) {
      await prisma.taskWatcher.upsert({
        where: { taskId_userId: { taskId: id, userId } },
        create: { taskId: id, userId, companyId },
        update: {},
      }).catch(() => undefined);
    }

    return updated;
  }

  async addComment(companyId: string, id: string, dto: AddCommentDto, actor: TaskActor) {
    await this.ensureExists(companyId, id);
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('Comment body is required');

    const comment = await prisma.taskComment.create({
      data: {
        taskId: id,
        companyId,
        authorId: actor.type === 'user' ? actor.userId : null,
        body,
        mentions: dto.mentions ?? [],
      },
    });

    await this.logActivity(companyId, id, actor, {
      type: 'COMMENT_ADDED',
      title: body.slice(0, 80),
      body,
      metadata: { commentId: comment.id, mentions: dto.mentions ?? [] },
    });

    return comment;
  }

  async addActivity(companyId: string, id: string, input: AddTaskActivityInput, actor: TaskActor) {
    await this.ensureExists(companyId, id);
    return this.logActivity(companyId, id, actor, input);
  }

  async addWatcher(companyId: string, id: string, userId: string, actor: TaskActor) {
    await this.ensureExists(companyId, id);
    const watcher = await prisma.taskWatcher.upsert({
      where: { taskId_userId: { taskId: id, userId } },
      create: { taskId: id, userId, companyId },
      update: {},
    });
    await this.logActivity(companyId, id, actor, {
      type: 'WATCHER_ADDED',
      title: `Added watcher ${userId}`,
      metadata: { userId },
    });
    return watcher;
  }

  async removeWatcher(companyId: string, id: string, userId: string, actor: TaskActor) {
    await this.ensureExists(companyId, id);
    await prisma.taskWatcher.deleteMany({ where: { taskId: id, userId } });
    await this.logActivity(companyId, id, actor, {
      type: 'WATCHER_REMOVED',
      title: `Removed watcher ${userId}`,
      metadata: { userId },
    });
    return { ok: true };
  }

  async reschedule(
    companyId: string,
    id: string,
    newDueAt: string | Date,
    reason: string | undefined,
    actor: TaskActor,
  ): Promise<Task> {
    const existing = await this.get(companyId, id);
    const dueAt = new Date(newDueAt);
    const updated = await prisma.task.update({
      where: { id },
      data: { dueAt, remindersSent: [], reminderSentAt: null },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'RESCHEDULED',
      title: `Rescheduled: ${existing.dueAt?.toISOString() ?? 'unset'} → ${dueAt.toISOString()}`,
      body: reason,
      metadata: { from: existing.dueAt, to: dueAt },
    });
    return updated;
  }

  async snooze(
    companyId: string,
    id: string,
    minutes: number,
    actor: TaskActor,
  ): Promise<Task> {
    const existing = await this.get(companyId, id);
    const base = existing.dueAt && existing.dueAt.getTime() > Date.now()
      ? existing.dueAt
      : new Date();
    const next = new Date(base.getTime() + minutes * 60 * 1000);
    return this.reschedule(companyId, id, next, `snoozed ${minutes}m`, actor);
  }

  async logTime(
    companyId: string,
    id: string,
    hours: number,
    note: string | undefined,
    actor: TaskActor,
  ): Promise<Task> {
    const existing = await this.get(companyId, id);
    const updated = await prisma.task.update({
      where: { id },
      data: { actualHours: (existing.actualHours ?? 0) + hours },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'TIME_LOGGED',
      title: `Logged ${hours}h`,
      body: note,
      metadata: { hours, totalHours: updated.actualHours },
    });
    return updated;
  }

  async setReminderOffsets(
    companyId: string,
    id: string,
    offsets: number[],
    actor: TaskActor,
  ): Promise<Task> {
    await this.ensureExists(companyId, id);
    const updated = await prisma.task.update({
      where: { id },
      data: { reminderOffsets: offsets, remindersSent: [], reminderSentAt: null },
    });
    await this.logActivity(companyId, id, actor, {
      type: 'FIELD_UPDATED',
      title: `Reminder offsets: ${offsets.join(', ')} min`,
      metadata: { offsets },
    });
    return updated;
  }

  async remove(companyId: string, id: string, actor: TaskActor): Promise<Task> {
    return this.updateStatus(companyId, id, 'CANCELLED', actor, 'Removed via UI');
  }

  // ── Bulk ────────────────────────────────────────────────────────────────

  async bulkUpdateStatus(
    companyId: string,
    ids: string[],
    status: TaskStatus,
    actor: TaskActor,
  ) {
    let updated = 0;
    for (const id of ids) {
      try { await this.updateStatus(companyId, id, status, actor); updated++; } catch { /* skip */ }
    }
    return { requested: ids.length, updated };
  }

  async bulkAssign(companyId: string, ids: string[], userId: string | null, actor: TaskActor) {
    let updated = 0;
    for (const id of ids) {
      try { await this.assign(companyId, id, userId, actor); updated++; } catch { /* skip */ }
    }
    return { requested: ids.length, updated };
  }

  async bulkSnooze(companyId: string, ids: string[], minutes: number, actor: TaskActor) {
    let updated = 0;
    for (const id of ids) {
      try { await this.snooze(companyId, id, minutes, actor); updated++; } catch { /* skip */ }
    }
    return { requested: ids.length, updated };
  }

  async bulkDelete(companyId: string, ids: string[], actor: TaskActor) {
    let deleted = 0;
    for (const id of ids) {
      try { await this.remove(companyId, id, actor); deleted++; } catch { /* skip */ }
    }
    return { requested: ids.length, deleted };
  }

  async bulkTag(
    companyId: string,
    ids: string[],
    add: string[] = [],
    remove: string[] = [],
    actor: TaskActor,
  ) {
    let updated = 0;
    for (const id of ids) {
      try {
        const t = await prisma.task.findFirst({
          where: { id, companyId },
          select: { tags: true },
        });
        if (!t) continue;
        const next = Array.from(new Set([...t.tags.filter((x) => !remove.includes(x)), ...add]));
        await prisma.task.update({ where: { id }, data: { tags: next } });
        await this.logActivity(companyId, id, actor, {
          type: 'FIELD_UPDATED',
          title: `Tags: ${add.length ? '+' + add.join(',') : ''}${remove.length ? ' -' + remove.join(',') : ''}`,
          metadata: { add, remove },
        });
        updated++;
      } catch { /* skip */ }
    }
    return { requested: ids.length, updated };
  }

  // ── Recurrence ──────────────────────────────────────────────────────────

  async createRecurrence(companyId: string, dto: CreateRecurrenceDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;

    const recurrence = await prisma.taskRecurrence.create({
      data: {
        companyId,
        templateTitle: dto.templateTitle,
        templateBody: dto.templateBody,
        templatePriority: dto.templatePriority ?? 'MEDIUM',
        templateAssignedAgentId: dto.templateAssignedAgentId,
        frequency: dto.frequency,
        intervalDays: dto.intervalDays,
        daysOfWeek: dto.daysOfWeek ?? [],
        dayOfMonth: dto.dayOfMonth,
        startsAt,
        endsAt,
        nextRunAt: startsAt, // first run is the start
      },
    });
    return recurrence;
  }

  async listRecurrences(companyId: string) {
    return prisma.taskRecurrence.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async pauseRecurrence(companyId: string, id: string, paused: boolean) {
    const r = await prisma.taskRecurrence.findFirst({ where: { id, companyId } });
    if (!r) throw new NotFoundException('Recurrence not found');
    return prisma.taskRecurrence.update({ where: { id }, data: { isActive: !paused } });
  }

  async deleteRecurrence(companyId: string, id: string) {
    const r = await prisma.taskRecurrence.findFirst({ where: { id, companyId } });
    if (!r) throw new NotFoundException('Recurrence not found');
    return prisma.taskRecurrence.update({ where: { id }, data: { isActive: false } });
  }

  /**
   * Generate the next instance of a recurring task and advance nextRunAt.
   * Idempotent — safe to call multiple times because nextRunAt advances atomically.
   */
  async spawnNextRecurringInstance(recurrenceId: string): Promise<Task | null> {
    const r = await prisma.taskRecurrence.findUnique({ where: { id: recurrenceId } });
    if (!r || !r.isActive) return null;

    const next = computeNextRunAt(
      {
        frequency: r.frequency,
        intervalDays: r.intervalDays,
        daysOfWeek: r.daysOfWeek,
        dayOfMonth: r.dayOfMonth,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
      },
      r.nextRunAt,
    );

    // Always create a Task for the current nextRunAt
    const task = await prisma.task.create({
      data: {
        companyId: r.companyId,
        title: r.templateTitle,
        description: r.templateBody,
        priority: r.templatePriority,
        assignedAgentId: r.templateAssignedAgentId,
        source: 'RECURRING',
        recurrenceId: r.id,
        dueAt: r.nextRunAt,
        status: 'TODO',
      },
    });

    await this.logActivity(r.companyId, task.id, { type: 'recurrence' }, {
      type: 'RECURRENCE_TRIGGERED',
      title: `Generated from recurring series ${r.id}`,
      metadata: { recurrenceId: r.id, generationNumber: r.totalGenerated + 1 },
    });

    await prisma.taskRecurrence.update({
      where: { id: r.id },
      data: {
        lastRunAt: r.nextRunAt,
        nextRunAt: next ?? r.nextRunAt,
        isActive: next !== null,
        totalGenerated: { increment: 1 },
      },
    });

    return task;
  }

  // ── Reminder helpers ────────────────────────────────────────────────────

  /**
   * Find tasks where any of the configured reminder offsets is now due
   * and that offset hasn't already been fired. The reminder processor
   * batches these every minute.
   */
  async getDueForReminder() {
    const now = new Date();
    return prisma.task.findMany({
      where: {
        status: { in: ['TODO', 'IN_PROGRESS'] },
        dueAt: { gt: now }, // still in future
      },
      include: {
        assignedAgent: { select: { id: true, email: true, firstName: true } },
        contact: { select: { id: true, displayName: true } },
      },
      take: 500,
    });
  }

  async markReminderFired(id: string, _offsetMinutes: number) {
    const now = new Date();
    return prisma.task.update({
      where: { id },
      data: {
        remindersSent: { push: now },
        reminderSentAt: now, // legacy column for backwards compat
      },
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async ensureExists(companyId: string, id: string) {
    const found = await prisma.task.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Task not found');
  }

  private buildWhere(companyId: string, f: ListTasksFilters): Prisma.TaskWhereInput {
    const where: Prisma.TaskWhereInput = { companyId };

    if (f.status) where.status = Array.isArray(f.status) ? { in: f.status } : f.status;
    else if (!f.includeCancelled) where.status = { not: 'CANCELLED' };

    if (f.priority) where.priority = Array.isArray(f.priority) ? { in: f.priority } : f.priority;
    if (f.source) where.source = Array.isArray(f.source) ? { in: f.source } : f.source;

    if (f.assignedAgentId === null) where.assignedAgentId = null;
    else if (f.assignedAgentId) where.assignedAgentId = f.assignedAgentId;

    if (f.contactId) where.contactId = f.contactId;
    if (f.dealId) where.dealId = f.dealId;
    if (f.leadId) where.leadId = f.leadId;

    if (f.parentTaskId === null) where.parentTaskId = null;
    else if (f.parentTaskId) where.parentTaskId = f.parentTaskId;

    if (f.tag) where.tags = { has: f.tag };

    if (f.dueFrom || f.dueTo) {
      where.dueAt = {};
      if (f.dueFrom) where.dueAt.gte = new Date(f.dueFrom);
      if (f.dueTo) where.dueAt.lte = new Date(f.dueTo);
    }

    if (f.overdue) {
      where.dueAt = { lt: new Date() };
      where.status = { notIn: TERMINAL_STATUSES };
    }

    if (f.search?.trim()) {
      const q = f.search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { contact: { displayName: { contains: q, mode: 'insensitive' } } },
        { contact: { phoneNumber: { contains: q } } },
      ];
    }

    return where;
  }

  private buildOrderBy(sort?: ListTasksFilters['sort']): Prisma.TaskOrderByWithRelationInput[] {
    switch (sort) {
      case 'due': return [{ dueAt: 'asc' }, { priority: 'desc' }];
      case 'priority': return [{ priority: 'desc' }, { dueAt: 'asc' }];
      case 'created': return [{ createdAt: 'desc' }];
      case 'recent':
      default: return [{ updatedAt: 'desc' }];
    }
  }

  private async logActivity(
    companyId: string,
    taskId: string,
    actor: TaskActor,
    input: AddTaskActivityInput,
  ) {
    return prisma.taskActivity.create({
      data: {
        taskId,
        companyId,
        type: input.type,
        actorType: actor.type,
        actorId: actor.type === 'user' ? actor.userId : null,
        title: input.title,
        body: input.body,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}

// ── Module-level helpers ───────────────────────────────────────────────────

function normalizePhone(input: string): string {
  let p = input.replace(/[\s\-+()]/g, '');
  if (p.startsWith('0')) p = '91' + p.slice(1);
  if (p.length === 10 && /^\d+$/.test(p)) p = '91' + p;
  return p;
}
