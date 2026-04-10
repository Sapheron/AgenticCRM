/**
 * Sequence Execution Processor — runs every minute to process pending enrollments.
 *
 * Finds enrollments where nextRunAt <= now and executes the current step.
 * Handles step execution via SequenceExecutionService and advances enrollments.
 */
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { prisma } from '@wacrm/database';
import { QUEUES } from '@wacrm/shared';
import { SequenceExecutionService } from './sequence-execution.service';
import { SequencesService } from './sequences.service';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

const sequenceExecutionService = new SequenceExecutionService();
const sequencesService = new SequencesService();

export function startSequenceExecutionProcessor(): Worker {
  const worker = new Worker(
    QUEUES.SEQUENCE_EXECUTION,
    async (_job: Job) => {
      const now = new Date();

      try {
        // Find enrollments ready to execute
        const enrollments = await prisma.sequenceEnrollment.findMany({
          where: {
            status: 'ACTIVE',
            nextRunAt: { lte: now },
          },
          include: {
            sequence: {
              include: {
                steps: { orderBy: { sortOrder: 'asc' } },
              },
            },
            contact: true,
          },
          take: 100, // Process in batches
          orderBy: { nextRunAt: 'asc' },
        });

        if (enrollments.length === 0) {
          logger.debug('No enrollments to process');
          return;
        }

        logger.info({ count: enrollments.length }, `Processing ${enrollments.length} enrollments`);

        let successCount = 0;
        let failureCount = 0;

        for (const enrollment of enrollments) {
          try {
            const step = enrollment.sequence.steps[enrollment.currentStep];

            if (!step) {
              // All steps completed - finish enrollment
              await sequencesService.completeEnrollment(
                enrollment.companyId,
                enrollment.id,
                { type: 'worker' },
              );
              successCount++;
              logger.info({ enrollmentId: enrollment.id, sequenceId: enrollment.sequenceId }, 'Enrollment completed (all steps done)');
              continue;
            }

            // Execute the step
            const result = await sequenceExecutionService.executeStep(
              enrollment.id,
              enrollment.currentStep,
            );

            if (result.success) {
              // Advance to next step
              const advanceResult = await sequencesService.advanceEnrollment(enrollment.id);

              if (advanceResult.completed) {
                logger.info(
                  { enrollmentId: enrollment.id, sequenceId: enrollment.sequenceId },
                  'Enrollment completed',
                );
              } else if (advanceResult.nextRunAt) {
                logger.info(
                  {
                    enrollmentId: enrollment.id,
                    sequenceId: enrollment.sequenceId,
                    currentStep: advanceResult.nextStepNumber,
                    nextRunAt: advanceResult.nextRunAt.toISOString(),
                  },
                  'Enrollment advanced',
                );
              }

              successCount++;
            } else {
              // Step execution failed - handle retry logic
              await handleExecutionError(enrollment.id, result.error);

              failureCount++;
            }
          } catch (error) {
            logger.error({ enrollmentId: enrollment.id, error }, 'Error processing enrollment');

            // Log the error to the enrollment
            await prisma.sequenceEnrollmentActivity.create({
              data: {
                enrollmentId: enrollment.id,
                companyId: enrollment.companyId,
                type: 'FAILED',
                actorType: 'worker',
                title: 'Execution failed',
                body: error instanceof Error ? error.message : 'Unknown error',
                metadata: {},
              },
            });

            failureCount++;
          }
        }

        logger.info(
          {
            processed: enrollments.length,
            success: successCount,
            failure: failureCount,
          },
          'Sequence execution batch complete',
        );
      } catch (error) {
        logger.error({ error }, 'Error in sequence execution processor');
      }
    },
    {
      connection,
      concurrency: 5,
      limiter: {
        max: 100, // Max 100 jobs per second
        duration: 1000, // Per second
      },
    },
  );

  worker.on('completed', (job: Job) => {
    logger.debug({ jobId: job.id }, 'Sequence execution job completed');
  });

  worker.on('failed', (job: Job | undefined, error: Error) => {
    logger.error({ jobId: job?.id, error }, 'Sequence execution job failed');
  });

  return worker;
}

/**
 * Handle execution error with retry logic
 */
async function handleExecutionError(enrollmentId: string, errorMessage?: string) {
  const enrollment = await prisma.sequenceEnrollment.findUnique({
    where: { id: enrollmentId },
  });

  if (!enrollment) return;

  const retryCount = enrollment.retryCount + 1;
  const MAX_RETRIES = 3;

  if (retryCount <= MAX_RETRIES) {
    // Retry with exponential backoff: 1h, 2h, 4h
    const retryDelayHours = Math.pow(2, retryCount - 1);
    const nextRunAt = new Date(Date.now() + retryDelayHours * 60 * 60 * 1000);

    await prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: {
        retryCount,
        lastError: errorMessage,
        nextRunAt,
      },
    });

    await prisma.sequenceEnrollmentActivity.create({
      data: {
        enrollmentId: enrollmentId,
        companyId: enrollment.companyId,
        type: 'RETRIED',
        actorType: 'worker',
        title: `Retrying step (attempt ${retryCount}/${MAX_RETRIES})`,
        body: errorMessage,
        metadata: { retryCount, nextRunAt: nextRunAt.toISOString() },
      },
    });
  } else {
    // Max retries exceeded - stop the enrollment
    await prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: {
        status: 'STOPPED',
        stoppedAt: new Date(),
        stoppedReason: `Max retries exceeded: ${errorMessage}`,
      },
    });

    await prisma.sequenceEnrollmentActivity.create({
      data: {
        enrollmentId: enrollmentId,
        companyId: enrollment.companyId,
        type: 'STOPPED',
        actorType: 'worker',
        title: 'Enrollment stopped after max retries',
        body: `Failed after ${MAX_RETRIES} retries`,
        metadata: { lastError: errorMessage },
      },
    });
  }
}
