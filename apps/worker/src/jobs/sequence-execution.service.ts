/**
 * Sequence Execution Service — plain (non-NestJS) version for the worker.
 * Mirrors apps/api/src/modules/sequences/sequence-execution.service.ts
 */
import { prisma } from '@wacrm/database';
import Redis from 'ioredis';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

function renderTemplate(
  body: string,
  variables: Record<string, string>,
  defaults: Record<string, string> = {},
): string {
  let rendered = body;
  const allVars = { ...defaults, ...variables };
  for (const [key, value] of Object.entries(allVars)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    rendered = rendered.replace(regex, value ?? '');
  }
  rendered = rendered.replace(/\{\{(\w+)\}\}/g, '');
  return rendered;
}

interface StepResult {
  success: boolean;
  message?: string;
  error?: string;
}

interface ActionResult {
  success: boolean;
  message?: string;
  error?: string;
}

export class SequenceExecutionService {
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis((process.env.REDIS_URL || '').trim(), {
      maxRetriesPerRequest: 3,
    });
  }

  async executeStep(enrollmentId: string, stepNumber: number): Promise<StepResult> {
    try {
      const enrollment = await prisma.sequenceEnrollment.findUnique({
        where: { id: enrollmentId },
        include: {
          sequence: { include: { steps: { orderBy: { sortOrder: 'asc' } } } },
          contact: true,
        },
      });

      if (!enrollment) return { success: false, error: 'Enrollment not found' };

      const step = enrollment.sequence.steps[stepNumber];
      if (!step) return { success: false, error: 'Step not found' };

      if (step.condition) {
        const shouldExecute = this.evaluateCondition(step.condition, enrollment.contact);
        if (!shouldExecute) return { success: true, message: 'Condition not met, skipped' };
      }

      const result = await this.executeAction(step, enrollment.contact, enrollment);
      return result.success
        ? { success: true, message: result.message }
        : { success: false, error: result.error };
    } catch (error) {
      logger.error({ enrollmentId, stepNumber, error }, 'Error executing step');
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async executeAction(step: any, contact: any, enrollment: any): Promise<ActionResult> {
    switch (step.action) {
      case 'send_message': return this.sendMessage(step, contact, enrollment);
      case 'send_email': return { success: true, message: 'Email step skipped (not implemented)' };
      case 'wait': return { success: true, message: 'Wait step completed' };
      case 'add_tag': return this.addTag(step, contact);
      case 'remove_tag': return this.removeTag(step, contact);
      case 'webhook': return this.triggerWebhook(step, contact, enrollment);
      case 'ai_task': return { success: true, message: 'AI task skipped (not implemented)' };
      default: return { success: false, error: `Unknown action: ${step.action}` };
    }
  }

  private async sendMessage(step: any, contact: any, enrollment: any): Promise<ActionResult> {
    try {
      let message = step.message;

      if (step.templateId) {
        const template = await prisma.template.findUnique({ where: { id: step.templateId } });
        if (!template) return { success: false, error: 'Template not found' };
        const variables = this.extractContactVariables(contact);
        message = renderTemplate(
          template.body,
          variables,
          (template.variables as Record<string, string>) || {},
        );
      }

      const account = await prisma.whatsAppAccount.findFirst({
        where: { companyId: enrollment.companyId, status: 'CONNECTED' },
      });
      if (!account) return { success: false, error: 'No connected WhatsApp account' };

      await this.redis.publish(
        'wa:outbound',
        JSON.stringify({ accountId: account.id, toPhone: contact.phoneNumber, text: message }),
      );

      return { success: true, message: 'Message sent successfully' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to send message' };
    }
  }

  private async addTag(step: any, contact: any): Promise<ActionResult> {
    try {
      if (!step.tagName) return { success: false, error: 'Tag name is required for add_tag action' };
      const tags = [...new Set([...contact.tags, step.tagName])];
      await prisma.contact.update({ where: { id: contact.id }, data: { tags } });
      return { success: true, message: `Added tag: ${step.tagName}` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to add tag' };
    }
  }

  private async removeTag(step: any, contact: any): Promise<ActionResult> {
    try {
      if (!step.tagName) return { success: false, error: 'Tag name is required for remove_tag action' };
      const tags = contact.tags.filter((t: string) => t !== step.tagName);
      await prisma.contact.update({ where: { id: contact.id }, data: { tags } });
      return { success: true, message: `Removed tag: ${step.tagName}` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to remove tag' };
    }
  }

  private async triggerWebhook(step: any, contact: any, enrollment: any): Promise<ActionResult> {
    try {
      if (!step.webhookUrl) return { success: false, error: 'Webhook URL is required' };
      const payload = {
        enrollmentId: enrollment.id,
        contact: {
          id: contact.id,
          phoneNumber: contact.phoneNumber,
          displayName: contact.displayName,
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          tags: contact.tags,
          customFields: contact.customFields,
        },
        sequence: { id: enrollment.sequence.id, name: enrollment.sequence.name },
        step: { sortOrder: step.sortOrder, action: step.action },
        timestamp: new Date().toISOString(),
      };
      const response = await fetch(step.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) return { success: true, message: 'Webhook triggered successfully' };
      return { success: false, error: `Webhook returned ${response.status}: ${response.statusText}` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to trigger webhook' };
    }
  }

  private evaluateCondition(condition: string, contact: any): boolean {
    try {
      const cond = JSON.parse(condition);
      if (cond.tags?.includes) return contact.tags.some((t: string) => cond.tags.includes.includes(t));
      if (cond.lifecycleStage?.eq) return contact.lifecycleStage === cond.lifecycleStage.eq;
      return true;
    } catch {
      return true;
    }
  }

  private extractContactVariables(contact: any): Record<string, string> {
    return {
      firstName: contact.firstName || '',
      lastName: contact.lastName || '',
      displayName: contact.displayName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
      email: contact.email || '',
      company: contact.companyName || '',
      phoneNumber: contact.phoneNumber || '',
      tags: contact.tags.join(', ') || '',
      ...((contact.customFields || {}) as Record<string, string>),
    };
  }
}
