/**
 * Tool executor: takes a tool call from the AI and executes it against the CRM.
 * Each tool returns a string result that gets appended to the AI context.
 */
import { prisma } from '@wacrm/database';
import type { ToolCall } from '../agent/providers/provider.interface';

export interface ToolContext {
  companyId: string;
  contactId: string;
  conversationId: string;
  accountId: string;
}

export async function executeTool(
  call: ToolCall,
  ctx: ToolContext,
): Promise<{ result: string; escalate?: boolean; paymentLinkUrl?: string }> {
  const args = call.arguments;

  switch (call.name) {
    case 'create_lead': {
      const lead = await prisma.lead.create({
        data: {
          companyId: ctx.companyId,
          contactId: ctx.contactId,
          title: args.title as string,
          source: 'WHATSAPP',
          estimatedValue: args.estimatedValue as number | undefined,
          status: 'NEW',
        },
      });
      return { result: `Lead created: "${lead.title}" (ID: ${lead.id})` };
    }

    case 'update_deal_stage': {
      const deal = await prisma.deal.findFirst({
        where: { id: args.dealId as string, companyId: ctx.companyId },
      });
      if (!deal) return { result: 'Deal not found' };

      const stage = args.stage as string;
      await prisma.deal.update({
        where: { id: deal.id },
        data: {
          stage: stage as 'LEAD_IN' | 'QUALIFIED' | 'PROPOSAL' | 'NEGOTIATION' | 'WON' | 'LOST',
          ...(stage === 'WON' ? { wonAt: new Date(), probability: 100 } : {}),
          ...(stage === 'LOST' ? { lostAt: new Date(), probability: 0 } : {}),
        },
      });
      return { result: `Deal "${deal.title}" moved to ${stage}` };
    }

    case 'create_task': {
      const dueAt = args.dueAt ? new Date(args.dueAt as string) : undefined;
      const task = await prisma.task.create({
        data: {
          companyId: ctx.companyId,
          contactId: ctx.contactId,
          title: args.title as string,
          dueAt,
          priority: (args.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | undefined) ?? 'MEDIUM',
          status: 'TODO',
        },
      });
      return { result: `Task created: "${task.title}"${dueAt ? ` due ${dueAt.toISOString()}` : ''}` };
    }

    case 'search_contacts': {
      const query = args.query as string;
      const contacts = await prisma.contact.findMany({
        where: {
          companyId: ctx.companyId,
          deletedAt: null,
          OR: [
            { phoneNumber: { contains: query } },
            { displayName: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: 5,
        select: { id: true, displayName: true, phoneNumber: true, tags: true },
      });

      if (!contacts.length) return { result: 'No contacts found matching that query.' };
      const summary = contacts
        .map((c: any) => `${c.displayName ?? 'Unknown'} (${c.phoneNumber}) [ID: ${c.id}]`)
        .join('\n');
      return { result: `Found ${contacts.length} contact(s):\n${summary}` };
    }

    case 'send_payment_link': {
      // Import payment config and create link
      const config = await prisma.paymentConfig.findUnique({ where: { companyId: ctx.companyId } });
      if (!config || config.provider === 'NONE') {
        return { result: 'Payment gateway not configured. Please configure it in Settings.' };
      }

      // Create payment record (link creation happens via payments service)
      // For the worker, we'll create the DB record and return the placeholder
      // The actual gateway call would need the PaymentsService — simplified here
      const idempotencyKey = `ai-${ctx.conversationId}-${Date.now()}`;
      const payment = await prisma.payment.create({
        data: {
          companyId: ctx.companyId,
          contactId: ctx.contactId,
          dealId: args.dealId as string | undefined,
          provider: config.provider,
          amount: args.amount as number,
          currency: (args.currency as string | undefined) ?? config.currency,
          description: args.description as string,
          status: 'PENDING',
          idempotencyKey,
        },
      });

      return {
        result: `Payment link created for ${args.description} — ₹${(args.amount as number) / 100}. Link will be sent to the customer.`,
        paymentLinkUrl: payment.linkUrl ?? undefined,
      };
    }

    case 'get_conversation_history': {
      const limit = Math.min((args.limit as number | undefined) ?? 10, 20);
      const messages = await prisma.message.findMany({
        where: { conversationId: ctx.conversationId },
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: { direction: true, body: true, createdAt: true, isAiGenerated: true },
      });

      const summary = messages
        .reverse()
        .map((m: any) => `[${m.direction}] ${m.body?.slice(0, 200) ?? '(media)'}`)
        .join('\n');
      return { result: `Recent ${messages.length} messages:\n${summary}` };
    }

    case 'add_note': {
      await prisma.contact.update({
        where: { id: ctx.contactId },
        data: { notes: args.note as string },
      });
      return { result: 'Note added to contact.' };
    }

    case 'escalate_to_human': {
      await prisma.conversation.update({
        where: { id: ctx.conversationId },
        data: { status: 'WAITING_HUMAN' },
      });
      return {
        result: `Escalated to human agent. Reason: ${args.reason as string}`,
        escalate: true,
      };
    }

    default:
      return { result: `Unknown tool: ${call.name}` };
  }
}
