/**
 * Sequences Service — plain (non-NestJS) helpers needed by the worker.
 * Mirrors completeEnrollment + advanceEnrollment from
 * apps/api/src/modules/sequences/sequences.service.ts
 */
import { prisma, EnrollmentActivityType } from '@wacrm/database';

type SequenceActor = { type: string; id?: string };

async function logEnrollmentActivity(
  enrollmentId: string,
  companyId: string,
  actor: SequenceActor,
  data: { type: EnrollmentActivityType; title: string; body?: string | null; metadata?: Record<string, unknown> },
) {
  await prisma.sequenceEnrollmentActivity.create({
    data: {
      enrollmentId,
      companyId,
      type: data.type,
      actorType: actor.type,
      actorId: actor.id,
      title: data.title,
      body: data.body ?? null,
      metadata: (data.metadata ?? {}) as object,
    },
  });
}

export class SequencesService {
  async completeEnrollment(companyId: string, enrollmentId: string, actor: SequenceActor) {
    const enrollment = await prisma.sequenceEnrollment.findFirst({
      where: { id: enrollmentId, companyId },
      include: { sequence: { include: { steps: true } } },
    });

    if (!enrollment) throw new Error('Enrollment not found');

    await prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        currentStep: enrollment.sequence.steps.length,
      },
    });

    await prisma.sequence.update({
      where: { id: enrollment.sequenceId },
      data: { completionCount: { increment: 1 } },
    });

    await logEnrollmentActivity(enrollmentId, companyId, actor, {
      type: EnrollmentActivityType.COMPLETED,
      title: 'Sequence completed',
    });

    return { success: true };
  }

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

    if (!enrollment) return { success: false, error: 'Enrollment not found' };
    if (enrollment.status !== 'ACTIVE') return { success: false, error: `Enrollment is ${enrollment.status}` };

    const nextStepNumber = enrollment.currentStep + 1;
    const step = enrollment.sequence.steps[nextStepNumber];

    if (!step) {
      await this.completeEnrollment(enrollment.companyId, enrollmentId, { type: 'worker' });
      return { success: true, completed: true };
    }

    const nextRunAt = new Date(Date.now() + step.delayHours * 60 * 60 * 1000);

    await prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: { currentStep: nextStepNumber, nextRunAt, lastStepAt: new Date() },
    });

    await logEnrollmentActivity(enrollmentId, enrollment.companyId, { type: 'worker' }, {
      type: EnrollmentActivityType.STEP_COMPLETED,
      title: `Step ${enrollment.currentStep} completed, moving to step ${nextStepNumber}`,
      metadata: { stepAction: step.action, delayHours: step.delayHours },
    });

    return { success: true, nextStepNumber, nextRunAt };
  }
}
