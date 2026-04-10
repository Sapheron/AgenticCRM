/**
 * Sequence Execution Service — handles step execution logic.
 *
 * This service is responsible for executing individual steps of a sequence,
 * including sending messages, adding tags, triggering webhooks, etc.
 */
import { Injectable, Logger } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import Redis from 'ioredis';
import { renderTemplate } from '../templates/template-utils';

interface StepResult {
  success: boolean;
  message?: string;
  error?: string;
}

interface ActionResult {
  success: boolean;
  message?: string;
  error?: string;
  nextRunAt?: Date;
}

@Injectable()
export class SequenceExecutionService {
  private readonly logger = new Logger(SequenceExecutionService.name);
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis((process.env.REDIS_URL || '').trim(), {
      maxRetriesPerRequest: 3,
    });
  }

  /**
   * Execute a single step for an enrollment
   */
  async executeStep(enrollmentId: string, stepNumber: number): Promise<StepResult> {
    try {
      // Get enrollment with sequence, contact, and step
      const enrollment = await prisma.sequenceEnrollment.findUnique({
        where: { id: enrollmentId },
        include: {
          sequence: {
            include: {
              steps: { orderBy: { sortOrder: 'asc' } },
            },
          },
          contact: true,
        },
      });

      if (!enrollment) {
        return { success: false, error: 'Enrollment not found' };
      }

      const step = enrollment.sequence.steps[stepNumber];
      if (!step) {
        return { success: false, error: 'Step not found' };
      }

      // Evaluate condition if present
      if (step.condition) {
        const shouldExecute = await this.evaluateCondition(step.condition, enrollment.contact, enrollment);
        if (!shouldExecute) {
          // Skip this step and move to next
          return { success: true, message: 'Condition not met, skipped' };
        }
      }

      // Execute action based on type
      const result = await this.executeAction(step, enrollment.contact, enrollment);

      if (result.success) {
        return { success: true, message: result.message };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      this.logger.error(`Error executing step ${stepNumber} for enrollment ${enrollmentId}`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute action based on type
   */
  private async executeAction(
    step: any,
    contact: any,
    enrollment: any,
  ): Promise<ActionResult> {
    switch (step.action) {
      case 'send_message':
        return this.sendMessage(step, contact, enrollment);
      case 'send_email':
        return this.sendEmail(step, contact, enrollment);
      case 'wait':
        return { success: true, message: 'Wait step completed' };
      case 'add_tag':
        return this.addTag(step, contact);
      case 'remove_tag':
        return this.removeTag(step, contact);
      case 'webhook':
        return this.triggerWebhook(step, contact, enrollment);
      case 'ai_task':
        return this.executeAiTask(step, contact, enrollment);
      default:
        return { success: false, error: `Unknown action: ${step.action}` };
    }
  }

  /**
   * Send WhatsApp message
   */
  private async sendMessage(step: any, contact: any, enrollment: any): Promise<ActionResult> {
    try {
      let message = step.message;

      // If templateId provided, render template
      if (step.templateId) {
        const template = await prisma.template.findUnique({
          where: { id: step.templateId },
        });

        if (!template) {
          return { success: false, error: 'Template not found' };
        }

        const variables = this.extractContactVariables(contact);
        message = renderTemplate(
          template.body,
          variables,
          (template.variables as Record<string, string>) || {},
        );
      }

      // Find connected WhatsApp account
      const account = await prisma.whatsAppAccount.findFirst({
        where: { companyId: enrollment.companyId, status: 'CONNECTED' },
      });

      if (!account) {
        return { success: false, error: 'No connected WhatsApp account' };
      }

      // Send via WhatsApp gateway
      await this.redis.publish(
        'wa:outbound',
        JSON.stringify({
          accountId: account.id,
          toPhone: contact.phoneNumber,
          text: message,
        }),
      );

      return { success: true, message: 'Message sent successfully' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send message',
      };
    }
  }

  /**
   * Send email (placeholder - implementation depends on email service)
   */
  private async sendEmail(_step: any, _contact: any, _enrollment: any): Promise<ActionResult> {
    // TODO: Implement email sending logic
    this.logger.warn(`Email sending not yet implemented`);
    return { success: true, message: 'Email step skipped (not implemented)' };
  }

  /**
   * Add tag to contact
   */
  private async addTag(step: any, contact: any): Promise<ActionResult> {
    try {
      const tagName = step.tagName;
      if (!tagName) {
        return { success: false, error: 'Tag name is required for add_tag action' };
      }

      const tags = [...new Set([...contact.tags, tagName])];
      await prisma.contact.update({
        where: { id: contact.id },
        data: { tags },
      });

      return { success: true, message: `Added tag: ${tagName}` };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add tag',
      };
    }
  }

  /**
   * Remove tag from contact
   */
  private async removeTag(step: any, contact: any): Promise<ActionResult> {
    try {
      const tagName = step.tagName;
      if (!tagName) {
        return { success: false, error: 'Tag name is required for remove_tag action' };
      }

      const tags = contact.tags.filter((t: string) => t !== tagName);
      await prisma.contact.update({
        where: { id: contact.id },
        data: { tags },
      });

      return { success: true, message: `Removed tag: ${tagName}` };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove tag',
      };
    }
  }

  /**
   * Trigger webhook
   */
  private async triggerWebhook(step: any, contact: any, enrollment: any): Promise<ActionResult> {
    try {
      if (!step.webhookUrl) {
        return { success: false, error: 'Webhook URL is required' };
      }

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
        sequence: {
          id: enrollment.sequence.id,
          name: enrollment.sequence.name,
        },
        step: {
          sortOrder: step.sortOrder,
          action: step.action,
        },
        timestamp: new Date().toISOString(),
      };

      const response = await fetch(step.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        return { success: true, message: 'Webhook triggered successfully' };
      } else {
        return {
          success: false,
          error: `Webhook returned ${response.status}: ${response.statusText}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to trigger webhook',
      };
    }
  }

  /**
   * Execute AI task (placeholder - can be used for custom AI actions)
   */
  private async executeAiTask(_step: any, _contact: any, _enrollment: any): Promise<ActionResult> {
    // TODO: Implement AI task execution logic
    this.logger.warn(`AI task execution not yet implemented`);
    return { success: true, message: 'AI task skipped (not implemented)' };
  }

  /**
   * Evaluate condition for step execution
   */
  private evaluateCondition(condition: string, contact: any, _enrollment: any): boolean {
    try {
      const conditionData = JSON.parse(condition);

      // Simple tag-based condition: { tags: { includes: "VIP" } }
      if (conditionData.tags?.includes) {
        return contact.tags.some((tag: string) => conditionData.tags.includes.includes(tag));
      }

      // Add more condition types as needed
      // { lifecycleStage: { eq: "LEAD" } }
      if (conditionData.lifecycleStage?.eq) {
        return contact.lifecycleStage === conditionData.lifecycleStage.eq;
      }

      // Default to true if no conditions
      return true;
    } catch (error) {
      this.logger.error(`Failed to evaluate condition: ${condition}`, error);
      return true; // Default to executing if condition parsing fails
    }
  }

  /**
   * Extract variables from contact for template rendering
   */
  private extractContactVariables(contact: any): Record<string, string> {
    return {
      firstName: contact.firstName || '',
      lastName: contact.lastName || '',
      displayName: contact.displayName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
      email: contact.email || '',
      company: contact.companyName || '',
      phoneNumber: contact.phoneNumber || '',
      tags: contact.tags.join(', ') || '',
      // Add custom fields
      ...((contact.customFields || {}) as Record<string, string>),
    };
  }
}
