import type { ToolDefinition } from '../agent/providers/provider.interface';

export const ALL_TOOLS: ToolDefinition[] = [
  {
    name: 'create_lead',
    description: 'Create a new lead in the CRM for this contact when they show buying intent.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short lead title, e.g. "Interested in Product X"' },
        estimatedValue: { type: 'number', description: 'Estimated deal value in local currency' },
        source: { type: 'string', description: 'Source of the lead, e.g. "whatsapp"' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_deal_stage',
    description: 'Move an existing deal to a new pipeline stage.',
    parameters: {
      type: 'object',
      properties: {
        dealId: { type: 'string', description: 'ID of the deal to update' },
        stage: {
          type: 'string',
          enum: ['LEAD_IN', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'],
        },
      },
      required: ['dealId', 'stage'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a follow-up task or reminder for the agent.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task description' },
        dueAt: { type: 'string', format: 'date-time', description: 'ISO 8601 due date' },
        priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
      },
      required: ['title'],
    },
  },
  {
    name: 'search_contacts',
    description: 'Search the CRM for existing contacts by name or phone number.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name or phone to search for' },
      },
      required: ['query'],
    },
  },
  {
    name: 'send_payment_link',
    description: 'Generate and send a payment link to the customer for an amount.',
    parameters: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Amount in smallest currency unit (paise/cents)' },
        currency: { type: 'string', description: 'ISO currency code, e.g. INR' },
        description: { type: 'string', description: 'Payment description shown to the customer' },
        dealId: { type: 'string', description: 'Optional deal ID to link the payment to' },
      },
      required: ['amount', 'description'],
    },
  },
  {
    name: 'get_conversation_history',
    description: 'Retrieve the recent conversation history for context.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of recent messages to fetch (max 20)', default: 10 },
      },
    },
  },
  {
    name: 'add_note',
    description: 'Add a note to the contact record in the CRM.',
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'Note content to save to the contact' },
      },
      required: ['note'],
    },
  },
  {
    name: 'escalate_to_human',
    description: 'Escalate the conversation to a human agent when the customer requests it or the issue is too complex.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Brief reason for escalation' },
      },
      required: ['reason'],
    },
  },
];

export function getTools(enabled = true): ToolDefinition[] {
  return enabled ? ALL_TOOLS : [];
}
