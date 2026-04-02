/**
 * Context builder: assembles the AI message context for a conversation.
 * Loads the cached AI context, recent messages, and CRM summary.
 */
import { prisma } from '@wacrm/database';
import type { ChatMessage } from './providers/provider.interface';

const MAX_MESSAGES = 30;

export async function buildContext(
  companyId: string,
  conversationId: string,
  contactId: string,
  systemPrompt: string,
): Promise<ChatMessage[]> {
  // Load contact summary for AI context
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: {
      leads: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { title: true, status: true, estimatedValue: true },
      },
      deals: {
        where: { deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 3,
        select: { title: true, stage: true, value: true },
      },
    },
  });

  const crmContext = contact
    ? [
        `Contact: ${contact.displayName ?? contact.firstName ?? 'Unknown'} (${contact.phoneNumber})`,
        contact.email ? `Email: ${contact.email}` : null,
        contact.tags.length ? `Tags: ${contact.tags.join(', ')}` : null,
        contact.notes ? `Notes: ${contact.notes}` : null,
        contact.leads.length
          ? `Leads: ${contact.leads.map((l) => `${l.title} [${l.status}]`).join('; ')}`
          : null,
        contact.deals.length
          ? `Deals: ${contact.deals.map((d) => `${d.title} [${d.stage}] ₹${d.value}`).join('; ')}`
          : null,
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const fullSystemPrompt = [
    systemPrompt,
    '',
    '=== CRM Context ===',
    crmContext,
  ]
    .filter(Boolean)
    .join('\n');

  // Load recent messages for context
  const recentMessages = await prisma.message.findMany({
    where: { conversationId },
    take: MAX_MESSAGES,
    orderBy: { createdAt: 'desc' },
    select: { direction: true, body: true, isAiGenerated: true, mediaType: true, createdAt: true },
  });

  const chatMessages: ChatMessage[] = [
    { role: 'system', content: fullSystemPrompt },
    ...recentMessages
      .reverse()
      .filter((m) => m.body || m.mediaType)
      .map((m): ChatMessage => ({
        role: m.direction === 'INBOUND' ? 'user' : 'assistant',
        content: m.body ?? `[${m.mediaType ?? 'media'} received]`,
      })),
  ];

  return chatMessages;
}
