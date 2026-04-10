/**
 * SequencesService — single write path for sequence management.
 *
 * Mirrors the entity upgrade pattern. Every mutation logs a `SequenceActivity`.
 * Supports full lifecycle: DRAFT → ACTIVE → PAUSED → ARCHIVED,
 * with enrollment management, step processing, and performance analytics.
 */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import type { Sequence, Prisma } from '@wacrm/database';
import {
  type SequenceActor,
  type CreateSequenceDto,
  type UpdateSequenceDto,
  type ListSequencesFilters,
  type CreateStepDto,
  type UpdateStepDto,
  type EnrollContactDto,
  type AddSequenceActivityInput,
  type AddEnrollmentActivityInput,
} from './sequences.types';

@Injectable()
export class SequencesService {
  // ── Reads ────────────────────────────────────────────────────────────────

  async list(companyId: string, filters: ListSequencesFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, filters.limit ?? 50);
    const where = this.buildWhere(companyId, filters);
    const orderBy = this.buildOrderBy(filters.sort);

    const [items, total] = await Promise.all([
      prisma.sequence.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        include: {
          steps: { orderBy: { sortOrder: 'asc' } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.sequence.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async get(companyId: string, id: string) {
    const sequence = await prisma.sequence.findFirst({
      where: { id, companyId },
      include: {
        steps: { orderBy: { sortOrder: 'asc' } },
        enrollments: { take: 20, orderBy: { enrolledAt: 'desc' } },
        activities: { orderBy: { createdAt: 'desc' }, take: 50 },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!sequence) throw new NotFoundException('Sequence not found');
    return sequence;
  }

  async getTimeline(companyId: string, id: string, limit = 100) {
    await this.ensureExists(companyId, id);
    return prisma.sequenceActivity.findMany({
      where: { sequenceId: id, companyId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, limit),
    });
  }

  async getStats(companyId: string) {
    const [total, byStatus, totalEnrollments, activeEnrollments, completedEnrollments, topSequences] = await Promise.all([
      prisma.sequence.count({ where: { companyId } }),
      prisma.sequence.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { _all: true },
      }),
      prisma.sequenceEnrollment.count({ where: { companyId } }),
      prisma.sequenceEnrollment.count({ where: { companyId, status: 'ACTIVE' } }),
      prisma.sequenceEnrollment.count({ where: { companyId, status: 'COMPLETED' } }),
      prisma.sequence.findMany({
        where: { companyId, status: 'ACTIVE' },
        orderBy: { useCount: 'desc' },
        take: 10,
        select: { id: true, name: true, useCount: true, completionCount: true },
      }),
    ]);

    const statusCounts = Object.fromEntries(byStatus.map((g) => [g.status, g._count._all]));
    const overallCompletionRate = totalEnrollments > 0 ? Math.round((completedEnrollments / totalEnrollments) * 100) : 0;

    return {
      totalSequences: total,
      activeSequences: statusCounts['ACTIVE'] ?? 0,
      draftSequences: statusCounts['DRAFT'] ?? 0,
      pausedSequences: statusCounts['PAUSED'] ?? 0,
      archivedSequences: statusCounts['ARCHIVED'] ?? 0,
      totalEnrollments,
      activeEnrollments,
      overallCompletionRate,
      topSequences: topSequences.map((s) => ({
        ...s,
        rate: s.useCount > 0 ? Math.round((s.completionCount / s.useCount) * 100) : 0,
      })),
    };
  }

  async getPerformance(companyId: string, sequenceId: string) {
    const sequence = await this.get(companyId, sequenceId);
    const enrollments = await prisma.sequenceEnrollment.findMany({
      where: { sequenceId, companyId },
    });

    const total = enrollments.length;
    const completed = enrollments.filter((e) => e.status === 'COMPLETED').length;
    const stopped = enrollments.filter((e) => e.status === 'STOPPED').length;
    const inProgress = enrollments.filter((e) => e.status === 'ACTIVE').length;
    const completionRate = total > 0 ? completed / total : 0;

    // Calculate average completion time
    const completedEnrollments = enrollments.filter((e) => e.status === 'COMPLETED' && e.enrolledAt && e.completedAt);
    const avgCompletionHours = completedEnrollments.length > 0
      ? completedEnrollments.reduce((sum, e) => sum + (e.completedAt!.getTime() - e.enrolledAt.getTime()) / (1000 * 60 * 60), 0) / completedEnrollments.length
      : null;

    // Drop-off analysis per step
    const stepsCount = sequence.steps.length;
    const dropOffPerStep = [];
    for (let i = 0; i < stepsCount; i++) {
      const enrolled = enrollments.filter((e) => e.currentStep >= i).length;
      const completed = enrollments.filter((e) => e.currentStep > i || (e.currentStep === i && e.status === 'COMPLETED')).length;
      const dropped = enrolled - completed;
      dropOffPerStep.push({
        stepNumber: i,
        enrolled,
        completed,
        dropped,
        dropOffRate: enrolled > 0 ? dropped / enrolled : 0,
      });
    }

    return {
      sequenceId,
      totalEnrollments: total,
      completed,
      stopped,
      inProgress,
      completionRate,
      avgCompletionHours,
      dropOffPerStep,
    };
  }

  // ── Enrollment Reads ─────────────────────────────────────────────────────

  async getEnrollments(companyId: string, sequenceId?: string, status?: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'STOPPED' | 'CANCELLED') {
    const where: Prisma.SequenceEnrollmentWhereInput = { companyId };
    if (sequenceId) where.sequenceId = sequenceId;
    if (status) where.status = status;

    return prisma.sequenceEnrollment.findMany({
      where,
      include: {
        sequence: { select: { id: true, name: true, status: true } },
        contact: { select: { id: true, phoneNumber: true, displayName: true, firstName: true, lastName: true } },
      },
      orderBy: { enrolledAt: 'desc' },
      take: 100,
    });
  }

  async getEnrollmentTimeline(companyId: string, enrollmentId: string, limit = 100) {
    const enrollment = await prisma.sequenceEnrollment.findFirst({
      where: { id: enrollmentId, companyId },
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');

    return prisma.sequenceEnrollmentActivity.findMany({
      where: { enrollmentId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, limit),
    });
  }

  // ── Sequence Writes ───────────────────────────────────────────────────────

  async create(companyId: string, dto: CreateSequenceDto, actor: SequenceActor): Promise<Sequence> {
    if (!dto.name?.trim()) throw new BadRequestException('Sequence name is required');

    const createdById = actor.type === 'user' ? actor.userId : null;

    const sequence = await prisma.sequence.create({
      data: {
        companyId,
        name: dto.name.trim(),
        description: dto.description,
        tags: dto.tags ?? [],
        status: 'DRAFT',
        createdById,
        ...(dto.steps && dto.steps.length > 0 ? {
          steps: {
            create: dto.steps.map((step, index) => ({
              sortOrder: step.sortOrder ?? index,
              delayHours: step.delayHours,
              action: step.action,
              message: step.message,
              templateId: step.templateId,
              subject: step.subject,
              tagName: step.tagName,
              webhookUrl: step.webhookUrl,
              condition: step.condition,
              metadata: step.metadata as Prisma.InputJsonValue,
            })),
          },
        } : {}),
      },
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
    });

    await this.logActivity(companyId, sequence.id, actor, {
      type: 'CREATED',
      title: `Sequence created: "${sequence.name}"`,
      metadata: { stepCount: sequence.steps.length },
    });

    return sequence as Sequence;
  }

  async update(companyId: string, id: string, dto: UpdateSequenceDto, actor: SequenceActor): Promise<Sequence> {
    const existing = await this.get(companyId, id);

    const data: Prisma.SequenceUpdateInput = {};
    const changes: string[] = [];

    const set = <K extends keyof UpdateSequenceDto>(key: K) => {
      if (dto[key] === undefined) return;
      const next = dto[key];
      const prev = (existing as unknown as Record<string, unknown>)[key as string];
      if (next !== prev) {
        (data as Record<string, unknown>)[key as string] = next;
        changes.push(String(key));
      }
    };

    set('name');
    set('description');
    set('tags');

    if (changes.length === 0) return existing as Sequence;

    const updated = await prisma.sequence.update({ where: { id }, data });

    await this.logActivity(companyId, id, actor, {
      type: 'UPDATED',
      title: `Updated: ${changes.join(', ')}`,
      metadata: { fields: changes },
    });

    return updated as Sequence;
  }

  async activate(companyId: string, id: string, actor: SequenceActor): Promise<Sequence> {
    const existing = await this.get(companyId, id);
    if (existing.status === 'ACTIVE') {
      return existing as Sequence;
    }
    if (existing.status === 'ARCHIVED') {
      throw new BadRequestException('Cannot activate an archived sequence');
    }

    const updated = await prisma.sequence.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });

    await this.logActivity(companyId, id, actor, {
      type: 'ACTIVATED',
      title: 'Sequence activated',
    });

    return updated as Sequence;
  }

  async pause(companyId: string, id: string, actor: SequenceActor): Promise<Sequence> {
    const existing = await this.get(companyId, id);
    if (existing.status === 'PAUSED') {
      return existing as Sequence;
    }
    if (existing.status === 'ARCHIVED') {
      throw new BadRequestException('Cannot pause an archived sequence');
    }

    const updated = await prisma.sequence.update({
      where: { id },
      data: { status: 'PAUSED' },
    });

    await this.logActivity(companyId, id, actor, {
      type: 'PAUSED',
      title: 'Sequence paused',
    });

    return updated as Sequence;
  }

  async archive(companyId: string, id: string, actor: SequenceActor): Promise<Sequence> {
    const existing = await this.get(companyId, id);
    if (existing.status === 'ARCHIVED') {
      return existing as Sequence;
    }

    const updated = await prisma.sequence.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });

    await this.logActivity(companyId, id, actor, {
      type: 'ARCHIVED',
      title: 'Sequence archived',
    });

    return updated as Sequence;
  }

  async duplicate(companyId: string, id: string, actor: SequenceActor, newName?: string): Promise<Sequence> {
    const source = await this.get(companyId, id);
    return this.create(
      companyId,
      {
        name: newName ?? `${source.name} (copy)`,
        description: source.description ?? undefined,
        tags: source.tags as string[],
        steps: source.steps.map((step) => ({
          sortOrder: step.sortOrder,
          delayHours: step.delayHours,
          action: step.action,
          message: step.message ?? undefined,
          templateId: step.templateId ?? undefined,
          subject: step.subject ?? undefined,
          tagName: step.tagName ?? undefined,
          webhookUrl: step.webhookUrl ?? undefined,
          condition: step.condition ?? undefined,
          metadata: step.metadata as Record<string, unknown>,
        })),
      },
      actor,
    );
  }

  async delete(companyId: string, id: string, actor: SequenceActor) {
    const existing = await this.get(companyId, id);
    if (existing.status === 'ACTIVE') {
      throw new BadRequestException('Cannot delete an active sequence. Pause or archive it first.');
    }

    await this.logActivity(companyId, id, actor, {
      type: 'DELETED',
      title: `Deleted sequence "${existing.name}"`,
    });

    return prisma.sequence.delete({ where: { id } });
  }

  // ── Step Management ─────────────────────────────────────────────────────────

  async addStep(companyId: string, sequenceId: string, dto: CreateStepDto, actor: SequenceActor) {
    await this.ensureExists(companyId, sequenceId);

    // Get next sort order
    const maxSort = await prisma.sequenceStep.findFirst({
      where: { sequenceId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    const step = await prisma.sequenceStep.create({
      data: {
        sequenceId,
        sortOrder: dto.sortOrder ?? (maxSort?.sortOrder ?? -1) + 1,
        delayHours: dto.delayHours,
        action: dto.action,
        message: dto.message,
        templateId: dto.templateId,
        subject: dto.subject,
        tagName: dto.tagName,
        webhookUrl: dto.webhookUrl,
        condition: dto.condition,
        metadata: dto.metadata as Prisma.InputJsonValue,
      },
    });

    await this.logActivity(companyId, sequenceId, actor, {
      type: 'STEPS_CHANGED',
      title: `Step added: ${dto.action}`,
    });

    return step;
  }

  async updateStep(companyId: string, stepId: string, dto: UpdateStepDto, actor: SequenceActor) {
    const step = await prisma.sequenceStep.findFirst({
      where: { id: stepId },
      include: { sequence: true },
    });

    if (!step || step.sequence.companyId !== companyId) {
      throw new NotFoundException('Step not found');
    }

    const data: Prisma.SequenceStepUpdateInput = {};
    if (dto.delayHours !== undefined) data.delayHours = dto.delayHours;
    if (dto.action !== undefined) data.action = dto.action;
    if (dto.message !== undefined) data.message = dto.message;
    if (dto.templateId !== undefined) {
      data.template = dto.templateId ? { connect: { id: dto.templateId } } : { disconnect: true };
    }
    if (dto.subject !== undefined) data.subject = dto.subject;
    if (dto.tagName !== undefined) data.tagName = dto.tagName;
    if (dto.webhookUrl !== undefined) data.webhookUrl = dto.webhookUrl;
    if (dto.condition !== undefined) data.condition = dto.condition;
    if (dto.metadata !== undefined) data.metadata = dto.metadata as Prisma.InputJsonValue;

    const updated = await prisma.sequenceStep.update({
      where: { id: stepId },
      data,
    });

    await this.logActivity(step.sequence.companyId, step.sequenceId, actor, {
      type: 'STEPS_CHANGED',
      title: `Step updated: ${dto.action || step.action}`,
    });

    return updated;
  }

  async removeStep(companyId: string, stepId: string, actor: SequenceActor) {
    const step = await prisma.sequenceStep.findFirst({
      where: { id: stepId },
      include: { sequence: true },
    });

    if (!step || step.sequence.companyId !== companyId) {
      throw new NotFoundException('Step not found');
    }

    await prisma.sequenceStep.delete({ where: { id: stepId } });

    await this.logActivity(step.sequence.companyId, step.sequenceId, actor, {
      type: 'STEPS_CHANGED',
      title: 'Step removed',
    });

    return { success: true };
  }

  async reorderSteps(companyId: string, sequenceId: string, stepIds: string[], actor: SequenceActor) {
    await this.ensureExists(companyId, sequenceId);

    // Verify all steps belong to this sequence
    const steps = await prisma.sequenceStep.findMany({
      where: { id: { in: stepIds }, sequenceId },
    });

    if (steps.length !== stepIds.length) {
      throw new BadRequestException('Some steps not found in this sequence');
    }

    // Update sort orders
    await Promise.all(
      steps.map((step, index) =>
        prisma.sequenceStep.update({
          where: { id: step.id },
          data: { sortOrder: index },
        })
      )
    );

    await this.logActivity(companyId, sequenceId, actor, {
      type: 'STEPS_CHANGED',
      title: `Steps reordered (${stepIds.length} steps)`,
    });

    return { success: true };
  }

  // ── Enrollment Management ───────────────────────────────────────────────────

  async enrollContact(companyId: string, sequenceId: string, dto: EnrollContactDto, actor: SequenceActor) {
    const sequence = await this.get(companyId, sequenceId);

    if (sequence.status !== 'ACTIVE') {
      throw new BadRequestException('Can only enroll contacts in ACTIVE sequences');
    }

    let contactId = dto.contactId;
    if (!contactId && dto.phoneNumber) {
      const contact = await prisma.contact.findFirst({
        where: { companyId, phoneNumber: dto.phoneNumber },
      });
      if (!contact) throw new NotFoundException('Contact not found');
      contactId = contact.id;
    }

    if (!contactId) {
      throw new BadRequestException('Either contactId or phoneNumber is required');
    }

    // Check if already enrolled
    const existing = await prisma.sequenceEnrollment.findFirst({
      where: { sequenceId, contactId },
    });

    if (existing && existing.status !== 'CANCELLED' && existing.status !== 'STOPPED') {
      throw new BadRequestException('Contact is already enrolled in this sequence');
    }

    const startAt = dto.startAt ? new Date(dto.startAt) : new Date();

    const enrollment = await prisma.sequenceEnrollment.create({
      data: {
        sequenceId,
        contactId,
        companyId,
        currentStep: 0,
        status: 'ACTIVE',
        enrolledAt: startAt,
        nextRunAt: new Date(startAt.getTime() + 24 * 60 * 60 * 1000), // Default 24h
      },
      include: { sequence: true, contact: true },
    });

    // Update sequence use count
    await prisma.sequence.update({
      where: { id: sequenceId },
      data: {
        useCount: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });

    await this.logActivity(companyId, sequenceId, actor, {
      type: 'ENROLLMENT_ADDED',
      title: `Enrolled contact: ${enrollment.contact.displayName || enrollment.contact.phoneNumber}`,
    });

    await this.logEnrollmentActivity(enrollment.id, actor, {
      type: 'ENROLLED',
      title: 'Enrolled in sequence',
    });

    return enrollment;
  }

  async unenrollContact(companyId: string, enrollmentId: string, actor: SequenceActor) {
    const enrollment = await prisma.sequenceEnrollment.findFirst({
      where: { id: enrollmentId, companyId },
      include: { sequence: true },
    });

    if (!enrollment) throw new NotFoundException('Enrollment not found');

    await prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'CANCELLED' },
    });

    await this.logEnrollmentActivity(enrollmentId, actor, {
      type: 'STOPPED',
      title: 'Unenrolled from sequence',
    });

    return { success: true };
  }

  async pauseEnrollment(companyId: string, enrollmentId: string, reason?: string, actor?: SequenceActor) {
    const enrollment = await prisma.sequenceEnrollment.findFirst({
      where: { id: enrollmentId, companyId },
    });

    if (!enrollment) throw new NotFoundException('Enrollment not found');
    if (enrollment.status !== 'ACTIVE') {
      throw new BadRequestException('Can only pause ACTIVE enrollments');
    }

    await prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: {
        status: 'PAUSED',
        pausedAt: new Date(),
        pausedReason: reason,
      },
    });

    await this.logEnrollmentActivity(enrollmentId, actor || { type: 'system' }, {
      type: 'PAUSED',
      title: 'Enrollment paused',
      body: reason,
    });

    return { success: true };
  }

  async resumeEnrollment(companyId: string, enrollmentId: string, actor: SequenceActor) {
    const enrollment = await prisma.sequenceEnrollment.findFirst({
      where: { id: enrollmentId, companyId },
      include: { sequence: { include: { steps: true } } },
    });

    if (!enrollment) throw new NotFoundException('Enrollment not found');
    if (enrollment.status !== 'PAUSED') {
      throw new BadRequestException('Can only resume PAUSED enrollments');
    }

    const currentStep = enrollment.sequence.steps[enrollment.currentStep];
    if (currentStep) {
      await prisma.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: {
          status: 'ACTIVE',
          pausedAt: null,
          pausedReason: null,
          nextRunAt: new Date(),
        },
      });
    }

    await this.logEnrollmentActivity(enrollmentId, actor, {
      type: 'RESUMED',
      title: 'Enrollment resumed',
    });

    return { success: true };
  }

  async stopEnrollment(companyId: string, enrollmentId: string, actor: SequenceActor, reason?: string) {
    const enrollment = await prisma.sequenceEnrollment.findFirst({
      where: { id: enrollmentId, companyId },
    });

    if (!enrollment) throw new NotFoundException('Enrollment not found');
    if (enrollment.status === 'COMPLETED' || enrollment.status === 'CANCELLED') {
      throw new BadRequestException('Enrollment already ended');
    }

    await prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: {
        status: 'STOPPED',
        stoppedAt: new Date(),
        stoppedReason: reason,
      },
    });

    await this.logEnrollmentActivity(enrollmentId, actor, {
      type: 'STOPPED',
      title: 'Enrollment stopped',
      body: reason,
    });

    return { success: true };
  }

  async completeEnrollment(companyId: string, enrollmentId: string, actor: SequenceActor) {
    const enrollment = await prisma.sequenceEnrollment.findFirst({
      where: { id: enrollmentId, companyId },
      include: {
        sequence: {
          include: { steps: true },
        },
      },
    });

    if (!enrollment) throw new NotFoundException('Enrollment not found');

    const updated = await prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        currentStep: enrollment.sequence.steps.length,
      },
    });

    // Update sequence completion count
    await prisma.sequence.update({
      where: { id: enrollment.sequenceId },
      data: { completionCount: { increment: 1 } },
    });

    await this.logEnrollmentActivity(enrollmentId, actor, {
      type: 'COMPLETED',
      title: 'Sequence completed',
    });

    return updated;
  }

  // ── Bulk Operations ─────────────────────────────────────────────────────────

  async bulkEnroll(companyId: string, sequenceId: string, contactIds: string[], actor: SequenceActor) {
    const sequence = await this.get(companyId, sequenceId);

    if (sequence.status !== 'ACTIVE') {
      throw new BadRequestException('Can only enroll contacts in ACTIVE sequences');
    }

    const results = await Promise.all(
      contactIds.map(async (contactId) => {
        try {
          const enrollment = await this.enrollContact(
            companyId,
            sequenceId,
            { contactId },
            actor,
          );
          return { success: true, enrollmentId: enrollment.id };
        } catch (error) {
          return { success: false, contactId, error: (error as Error).message };
        }
      })
    );

    const successCount = results.filter((r) => r.success).length;

    await this.logActivity(companyId, sequenceId, actor, {
      type: 'BULK_ENROLLED',
      title: `Bulk enrolled: ${successCount}/${contactIds.length} contacts`,
      metadata: { results },
    });

    return {
      total: contactIds.length,
      successful: successCount,
      failed: contactIds.length - successCount,
      results,
    };
  }

  async bulkUnenroll(companyId: string, enrollmentIds: string[], actor: SequenceActor) {
    let successful = 0;
    const errors: Array<{ enrollmentId: string; error: string }> = [];

    for (const enrollmentId of enrollmentIds) {
      try {
        await this.unenrollContact(companyId, enrollmentId, actor);
        successful++;
      } catch (error) {
        errors.push({ enrollmentId, error: (error as Error).message });
      }
    }

    return {
      total: enrollmentIds.length,
      successful,
      failed: enrollmentIds.length - successful,
      errors,
    };
  }

  async bulkPauseEnrollments(companyId: string, enrollmentIds: string[], actor: SequenceActor, reason?: string) {
    let successful = 0;
    const errors: Array<{ enrollmentId: string; error: string }> = [];

    for (const enrollmentId of enrollmentIds) {
      try {
        await this.pauseEnrollment(companyId, enrollmentId, reason, actor);
        successful++;
      } catch (error) {
        errors.push({ enrollmentId, error: (error as Error).message });
      }
    }

    return {
      total: enrollmentIds.length,
      successful,
      failed: enrollmentIds.length - successful,
      errors,
    };
  }

  // ── Execution Support (called by worker) ───────────────────────────────────

  async advanceEnrollment(enrollmentId: string): Promise<{
    success: boolean;
    nextStepNumber?: number;
    nextRunAt?: Date;
    completed?: boolean;
    error?: string;
  }> {
    const enrollment = await prisma.sequenceEnrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        sequence: { include: { steps: { orderBy: { sortOrder: 'asc' } } } },
        contact: true,
      },
    });

    if (!enrollment) {
      return { success: false, error: 'Enrollment not found' };
    }

    if (enrollment.status !== 'ACTIVE') {
      return { success: false, error: `Enrollment is ${enrollment.status}` };
    }

    const nextStepNumber = enrollment.currentStep + 1;
    const step = enrollment.sequence.steps[nextStepNumber];

    if (!step) {
      // All steps completed
      await this.completeEnrollment(enrollment.companyId, enrollmentId, { type: 'worker' });
      return { success: true, completed: true };
    }

    // Calculate next run time
    const nextRunAt = new Date(Date.now() + step.delayHours * 60 * 60 * 1000);

    await prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: {
        currentStep: nextStepNumber,
        nextRunAt,
        lastStepAt: new Date(),
      },
    });

    await this.logEnrollmentActivity(enrollmentId, { type: 'worker' }, {
      type: 'STEP_COMPLETED',
      title: `Step ${enrollment.currentStep} completed, moving to step ${nextStepNumber}`,
      metadata: { stepAction: step.action, delayHours: step.delayHours },
    });

    return {
      success: true,
      nextStepNumber,
      nextRunAt,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────────

  private async ensureExists(companyId: string, id: string) {
    const found = await prisma.sequence.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Sequence not found');
  }

  private buildWhere(companyId: string, f: ListSequencesFilters): Prisma.SequenceWhereInput {
    const where: Prisma.SequenceWhereInput = { companyId };
    if (f.status) where.status = f.status;
    if (f.tags && f.tags.length > 0) {
      where.tags = { hasSome: f.tags };
    }
    if (f.search?.trim()) {
      const q = f.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private buildOrderBy(sort?: ListSequencesFilters['sort']): Prisma.SequenceOrderByWithRelationInput {
    switch (sort) {
      case 'recent':
      default:
        return { createdAt: 'desc' };
      case 'used':
        return { useCount: 'desc' };
      case 'name':
        return { name: 'asc' };
      case 'completion':
        return { completionCount: 'desc' };
    }
  }

  private async logActivity(
    companyId: string,
    sequenceId: string,
    actor: SequenceActor,
    input: AddSequenceActivityInput,
  ) {
    return prisma.sequenceActivity.create({
      data: {
        sequenceId,
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

  private async logEnrollmentActivity(
    enrollmentId: string,
    actor: SequenceActor,
    input: AddEnrollmentActivityInput,
  ) {
    const enrollment = await prisma.sequenceEnrollment.findUnique({
      where: { id: enrollmentId },
      select: { companyId: true },
    });

    if (!enrollment) return;

    return prisma.sequenceEnrollmentActivity.create({
      data: {
        enrollmentId,
        companyId: enrollment.companyId,
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
