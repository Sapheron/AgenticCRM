/**
 * Admin CRM Tools — AI can control the entire CRM via these tools.
 * Each tool has: name, description, parameters (JSON Schema), execute function.
 */
import { prisma } from '@wacrm/database';
import Redis from 'ioredis';
import { MemoryService } from '../memory/memory.service';
import { LeadsService } from '../leads/leads.service';
import type { LeadActor } from '../leads/leads.types';
import { DealsService } from '../deals/deals.service';
import type { DealActor } from '../deals/deals.types';
import { TasksService } from '../tasks/tasks.service';
import type { TaskActor } from '../tasks/tasks.types';
import { ProductsService } from '../products/products.service';
import type { ProductActor } from '../products/products.types';
import { BroadcastService } from '../broadcast/broadcast.service';
import type { BroadcastActor } from '../broadcast/broadcast.types';
import { TemplatesService } from '../templates/templates.service';
import type { TemplateActor } from '../templates/templates.types';
import { SequencesService } from '../sequences/sequences.service';
import { SequenceMemoryService } from '../sequences/sequence-memory.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import type {
  CampaignActor,
  CampaignAudienceFilter,
  CreateCampaignDto,
  UpdateCampaignDto,
  ListCampaignsFilters,
} from '../campaigns/campaigns.types';
import { FormsService } from '../forms/forms.service';
import { LeadsService as FormsLeadsShim } from '../leads/leads.service';
import type {
  FormActor,
  FormField,
  CreateFormDto,
  UpdateFormDto,
  AutoActionsConfig,
  ListFormsFilters,
} from '../forms/forms.types';
import { QuotesService } from '../quotes/quotes.service';
import type {
  QuoteActor,
  CreateQuoteDto,
  UpdateQuoteDto,
  LineItemInput,
  ListQuotesFilters,
} from '../quotes/quotes.types';
import { formatMinor } from '../quotes/quotes.calc';
import { InvoicesService } from '../invoices/invoices.service';
import type {
  InvoiceActor,
  CreateInvoiceDto,
  UpdateInvoiceDto,
  ListInvoicesFilters,
  LineItemInput as InvoiceLineItemInput,
} from '../invoices/invoices.types';
import { PaymentsService } from '../payments/payments.service';
import type {
  PaymentActor,
  CreatePaymentLinkDto,
  RecordManualPaymentDto,
  UpdatePaymentDto,
  RefundPaymentDto,
  ListPaymentsFilters,
} from '../payments/payments.types';
import { TicketsService } from '../tickets/tickets.service';
import type {
  TicketActor,
  CreateTicketDto,
  UpdateTicketDto,
  ListTicketsFilters,
} from '../tickets/tickets.types';
import { Queue } from 'bullmq';
import { QUEUES } from '@wacrm/shared';
import type { ChatAttachment } from './attachments';

// Memory service is a plain class (no DI deps), so we can instantiate it once
// here and reuse across tool calls. Tools that don't go through Nest's DI
// container (like the chat tools) need this.
const memoryService = new MemoryService();
const leadsService = new LeadsService();
const dealsService = new DealsService();
const tasksService = new TasksService();
const productsService = new ProductsService();
const templatesService = new TemplatesService();
const sequencesService = new SequencesService();
const sequenceMemoryService = new SequenceMemoryService();
const campaignsService = new CampaignsService();
// FormsService takes a LeadsService (Nest DI usually handles this), so we
// instantiate a local LeadsService without DI hookup — all LeadsService
// methods used by FormsService.submit are plain prisma reads/writes.
const formsService = new FormsService(new FormsLeadsShim());
const quotesService = new QuotesService();
const invoicesService = new InvoicesService();
// PaymentsService needs an InvoicesService for auto-reconciliation.
// Reuse the same singleton so the activity log is consistent.
const paymentsService = new PaymentsService(invoicesService);
const ticketsService = new TicketsService();

// BroadcastService takes a BullMQ Queue. We construct one here so the AI
// tools can drive the same single-write-path service the controller uses.
const broadcastQueue = new Queue(QUEUES.BROADCAST, {
  connection: new Redis((process.env.REDIS_URL || '').trim(), { maxRetriesPerRequest: null }),
});
const broadcastsService = new BroadcastService(broadcastQueue);

const AI_ACTOR: LeadActor = { type: 'ai' };
const AI_DEAL_ACTOR: DealActor = { type: 'ai' };
const AI_TASK_ACTOR: TaskActor = { type: 'ai' };
const AI_PRODUCT_ACTOR: ProductActor = { type: 'ai' };
const AI_BROADCAST_ACTOR: BroadcastActor = { type: 'ai' };
const AI_TEMPLATE_ACTOR: TemplateActor = { type: 'ai' };
const AI_CAMPAIGN_ACTOR: CampaignActor = { type: 'ai' };
const AI_FORM_ACTOR: FormActor = { type: 'ai' };
const AI_QUOTE_ACTOR: QuoteActor = { type: 'ai' };
const AI_INVOICE_ACTOR: InvoiceActor = { type: 'ai' };
const AI_PAYMENT_ACTOR: PaymentActor = { type: 'ai' };
const AI_TICKET_ACTOR: TicketActor = { type: 'ai' };

/**
 * Per-call execution context — anything that isn't part of the AI's tool args
 * but is needed to fulfill the call. Currently used to surface the user's
 * just-uploaded chat attachments to tools like `send_whatsapp` so the AI can
 * forward an image to a contact without having to re-encode it.
 */
export interface ToolContext {
  attachments?: ChatAttachment[];
}

const redis = new Redis((process.env.REDIS_URL || '').trim());

// ── Tool Definition Type ────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  result: string;
}

type ToolExecutor = (
  args: Record<string, unknown>,
  companyId: string,
  context: ToolContext,
) => Promise<string>;

interface AdminTool {
  definition: ToolDefinition;
  execute: ToolExecutor;
}

// ── Tool Definitions ────────────────────────────────────────────────────────

const tools: AdminTool[] = [
  // ── Contacts ──────────────────────────────────────────────────────────────
  {
    definition: {
      name: 'create_contact',
      description: 'Create a new contact in the CRM. Use when the user asks to add a contact.',
      parameters: {
        type: 'object',
        properties: {
          phoneNumber: { type: 'string', description: 'Phone number with country code (e.g., 919876543210)' },
          displayName: { type: 'string', description: 'Full name of the contact' },
          email: { type: 'string', description: 'Email address' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags to apply' },
        },
        required: ['phoneNumber'],
      },
    },
    execute: async (args, companyId) => {
      const phone = args.phoneNumber as string;
      const contact = await prisma.contact.upsert({
        where: { companyId_phoneNumber: { companyId, phoneNumber: phone } },
        create: {
          companyId,
          phoneNumber: phone,
          displayName: (args.displayName as string) || undefined,
          email: (args.email as string) || undefined,
          tags: (args.tags as string[]) || [],
        },
        update: {
          // Restore if soft-deleted, update fields
          deletedAt: null,
          ...(args.displayName ? { displayName: args.displayName as string } : {}),
          ...(args.email ? { email: args.email as string } : {}),
          ...(args.tags ? { tags: args.tags as string[] } : {}),
        },
      });
      return `Created contact: ${contact.displayName || contact.phoneNumber} (ID: ${contact.id})`;
    },
  },
  {
    definition: {
      name: 'update_contact',
      description: 'Update an existing contact. Find by contactId, phoneNumber, or displayName. Use newPhoneNumber to change the phone.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'Contact ID (best way to identify)' },
          phoneNumber: { type: 'string', description: 'Current phone number (used to find the contact)' },
          displayName: { type: 'string', description: 'Current display name (used to find the contact if no ID/phone)' },
          newPhoneNumber: { type: 'string', description: 'New phone number to set' },
          newDisplayName: { type: 'string', description: 'New display name to set' },
          email: { type: 'string', description: 'New email to set' },
          tags: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
          companyName: { type: 'string' },
          jobTitle: { type: 'string' },
          lifecycleStage: { type: 'string' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      // Find the contact - by contactId first, then by phoneNumber lookup, then by displayName
      let id = args.contactId as string;
      if (!id && args.phoneNumber) {
        // Try exact phone match first
        const found = await prisma.contact.findFirst({ where: { companyId, phoneNumber: args.phoneNumber as string, deletedAt: null } });
        if (found) id = found.id;
      }
      if (!id && args.displayName) {
        const found = await prisma.contact.findFirst({ where: { companyId, displayName: { contains: args.displayName as string, mode: 'insensitive' as const }, deletedAt: null } });
        if (found) id = found.id;
      }
      if (!id) return 'Contact not found. Provide contactId, phoneNumber, or displayName.';

      // Build update data — include ALL possible fields
      const data: Record<string, unknown> = {};
      if (args.newPhoneNumber) data.phoneNumber = (args.newPhoneNumber as string).replace(/[\s\-\+\(\)]/g, '');
      if (args.displayName && !args.contactId) { /* displayName was used for lookup, don't update it */ }
      else if (args.displayName) data.displayName = args.displayName;
      if (args.newDisplayName) data.displayName = args.newDisplayName;
      if (args.email) data.email = args.email;
      if (args.tags) data.tags = args.tags;
      if (args.notes) data.notes = args.notes;
      if (args.companyName) data.companyName = args.companyName;
      if (args.jobTitle) data.jobTitle = args.jobTitle;
      if (args.lifecycleStage) data.lifecycleStage = args.lifecycleStage;

      if (Object.keys(data).length === 0) return 'No fields to update. Specify what to change.';

      const updated = await prisma.contact.update({ where: { id }, data });
      return `Updated contact: ${updated.displayName || updated.phoneNumber} (ID: ${updated.id})`;
    },
  },
  {
    definition: {
      name: 'delete_contact',
      description: 'Soft-delete a contact from the CRM.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'Contact ID to delete' },
          phoneNumber: { type: 'string', description: 'Phone to search by' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      let id = args.contactId as string;
      if (!id && args.phoneNumber) {
        const found = await prisma.contact.findFirst({ where: { companyId, phoneNumber: args.phoneNumber as string, deletedAt: null } });
        if (!found) return `Contact not found`;
        id = found.id;
      }
      if (!id) return 'Please provide contactId or phoneNumber';
      await prisma.contact.update({ where: { id }, data: { deletedAt: new Date() } });
      return `Contact deleted`;
    },
  },
  {
    definition: {
      name: 'search_contacts',
      description: 'Search contacts by name, phone, email, or tag. Returns up to 10 results.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term (name, phone, or email)' },
          tag: { type: 'string', description: 'Filter by tag' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      const q = (args.query as string) || '';
      const where: Record<string, unknown> = { companyId, deletedAt: null };
      if (q) {
        where.OR = [
          { displayName: { contains: q, mode: 'insensitive' } },
          { phoneNumber: { contains: q } },
          { email: { contains: q, mode: 'insensitive' } },
        ];
      }
      if (args.tag) where.tags = { has: args.tag as string };
      const contacts = await prisma.contact.findMany({ where: where as any, take: 10, orderBy: { createdAt: 'desc' } });
      if (!contacts.length) return 'No contacts found';
      return contacts.map((c) => `- ${c.displayName || 'No name'} | ${c.phoneNumber} | ${c.email || 'no email'} | tags: ${c.tags.join(', ') || 'none'} | ID: ${c.id}`).join('\n');
    },
  },
  {
    definition: {
      name: 'get_contact',
      description: 'Get full details of a specific contact.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          phoneNumber: { type: 'string' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      const where = args.contactId ? { id: args.contactId as string } : { companyId, phoneNumber: args.phoneNumber as string };
      const c = await prisma.contact.findFirst({ where: where as any });
      if (!c) return 'Contact not found';
      return `Name: ${c.displayName || 'N/A'}\nPhone: ${c.phoneNumber}\nEmail: ${c.email || 'N/A'}\nTags: ${c.tags.join(', ') || 'none'}\nNotes: ${c.notes || 'none'}\nCreated: ${c.createdAt.toISOString()}\nID: ${c.id}`;
    },
  },

  // ── Leads (full lifecycle, all routed through LeadsService) ───────────────
  {
    definition: {
      name: 'list_leads',
      description: 'List leads with rich filters. Use this to find leads by status, source, priority, score range, value range, or text search. Always prefer this over reading leads ad-hoc.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'NEGOTIATING', 'WON', 'LOST', 'DISQUALIFIED'] },
          source: { type: 'string', enum: ['WHATSAPP', 'WEBSITE', 'REFERRAL', 'INBOUND_EMAIL', 'OUTBOUND', 'CAMPAIGN', 'FORM', 'IMPORT', 'AI_CHAT', 'MANUAL', 'OTHER'] },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          assignedAgentId: { type: 'string', description: 'User ID of the assignee, or "null" for unassigned' },
          tag: { type: 'string', description: 'Single tag to filter by' },
          search: { type: 'string', description: 'Free-text search over title/notes/contact name/phone' },
          scoreMin: { type: 'number' },
          valueMin: { type: 'number' },
          nextActionDue: { type: 'boolean', description: 'Only return leads with overdue next-action' },
          sort: { type: 'string', enum: ['recent', 'score', 'value', 'next_action', 'created'] },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      const result = await leadsService.list(companyId, {
        status: args.status as never,
        source: args.source as never,
        priority: args.priority as never,
        assignedAgentId: args.assignedAgentId === 'null' ? null : (args.assignedAgentId as string | undefined),
        tag: args.tag as string | undefined,
        search: args.search as string | undefined,
        scoreMin: args.scoreMin as number | undefined,
        valueMin: args.valueMin as number | undefined,
        nextActionDue: args.nextActionDue as boolean | undefined,
        sort: args.sort as never,
        limit: (args.limit as number) ?? 20,
      });
      if (!result.items.length) return 'No leads match those filters.';
      return [
        `Found ${result.total} lead(s) (showing ${result.items.length}):`,
        ...result.items.map((l) => {
          const contact = l.contact?.displayName ?? l.contact?.phoneNumber ?? '—';
          const value = l.estimatedValue ? `₹${l.estimatedValue}` : '—';
          return `- [${l.score}] "${l.title}" | ${l.status} | ${l.priority} | ${value} | ${contact} | ID: ${l.id}`;
        }),
      ].join('\n');
    },
  },
  {
    definition: {
      name: 'get_lead',
      description: 'Fetch a lead with its last 10 timeline activities. Use after list_leads or when the user references a specific lead.',
      parameters: {
        type: 'object',
        properties: { leadId: { type: 'string' } },
        required: ['leadId'],
      },
    },
    execute: async (args, companyId) => {
      const lead = await leadsService.get(companyId, args.leadId as string);
      const recent = lead.activities.slice(0, 10);
      const lines = [
        `Lead "${lead.title}" (ID: ${lead.id})`,
        `Status: ${lead.status} · Priority: ${lead.priority} · Score: ${lead.score} · Value: ${lead.estimatedValue ?? '—'} ${lead.currency}`,
        `Source: ${lead.source} · Tags: ${lead.tags.join(', ') || '—'}`,
        `Contact: ${lead.contact.displayName ?? lead.contact.phoneNumber} (${lead.contact.phoneNumber})`,
        lead.assignedAgent ? `Assigned to: ${lead.assignedAgent.firstName} ${lead.assignedAgent.lastName}` : 'Unassigned',
        lead.expectedCloseAt ? `Expected close: ${lead.expectedCloseAt.toISOString().slice(0, 10)}` : '',
        lead.nextActionAt ? `Next action: ${lead.nextActionAt.toISOString().slice(0, 16)} — ${lead.nextActionNote ?? ''}` : '',
        '',
        'Recent activity:',
        ...recent.map((a) => `  • ${a.createdAt.toISOString().slice(0, 16)} [${a.type}] ${a.title}`),
      ].filter(Boolean);
      return lines.join('\n');
    },
  },
  {
    definition: {
      name: 'create_lead',
      description: 'Create a new sales lead. Auto-creates a contact from `phoneNumber` if needed. Refuses if an open lead already exists for the same contact in the last 30 days unless `force: true`.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          contactId: { type: 'string' },
          phoneNumber: { type: 'string', description: 'Used if no contactId — upserts a contact' },
          contactName: { type: 'string', description: 'Optional display name when upserting a contact' },
          source: { type: 'string', enum: ['WHATSAPP', 'WEBSITE', 'REFERRAL', 'INBOUND_EMAIL', 'OUTBOUND', 'CAMPAIGN', 'FORM', 'IMPORT', 'AI_CHAT', 'MANUAL', 'OTHER'] },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          estimatedValue: { type: 'number' },
          currency: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          expectedCloseAt: { type: 'string', description: 'ISO date' },
          notes: { type: 'string' },
          force: { type: 'boolean', description: 'Bypass duplicate detection' },
        },
        required: ['title'],
      },
    },
    execute: async (args, companyId) => {
      const lead = await leadsService.create(
        companyId,
        {
          title: args.title as string,
          contactId: args.contactId as string | undefined,
          phoneNumber: args.phoneNumber as string | undefined,
          contactName: args.contactName as string | undefined,
          source: args.source as never,
          priority: args.priority as never,
          estimatedValue: args.estimatedValue as number | undefined,
          currency: args.currency as string | undefined,
          tags: args.tags as string[] | undefined,
          expectedCloseAt: args.expectedCloseAt as string | undefined,
          notes: args.notes as string | undefined,
          force: args.force as boolean | undefined,
        },
        AI_ACTOR,
      );
      return `Created lead "${lead.title}" (ID: ${lead.id}, status: ${lead.status}, score: ${lead.score})`;
    },
  },
  {
    definition: {
      name: 'update_lead',
      description: 'Update arbitrary lead fields. Field-level changes are diffed and logged to the activity timeline.',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string' },
          title: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          estimatedValue: { type: 'number' },
          probability: { type: 'number' },
          tags: { type: 'array', items: { type: 'string' } },
          expectedCloseAt: { type: 'string' },
          nextActionAt: { type: 'string', description: 'When to follow up next (ISO date)' },
          nextActionNote: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['leadId'],
      },
    },
    execute: async (args, companyId) => {
      const lead = await leadsService.update(
        companyId,
        args.leadId as string,
        {
          title: args.title as string | undefined,
          priority: args.priority as never,
          estimatedValue: args.estimatedValue as number | undefined,
          probability: args.probability as number | undefined,
          tags: args.tags as string[] | undefined,
          expectedCloseAt: args.expectedCloseAt as string | undefined,
          nextActionAt: args.nextActionAt as string | undefined,
          nextActionNote: args.nextActionNote as string | undefined,
          notes: args.notes as string | undefined,
        },
        AI_ACTOR,
      );
      return `Updated lead "${lead.title}" (status: ${lead.status}, score: ${lead.score})`;
    },
  },
  {
    definition: {
      name: 'delete_lead',
      description: 'Soft-delete a lead.',
      parameters: { type: 'object', properties: { leadId: { type: 'string' } }, required: ['leadId'] },
    },
    execute: async (args, companyId) => {
      await leadsService.remove(companyId, args.leadId as string, AI_ACTOR);
      return `Deleted lead ${args.leadId as string}`;
    },
  },
  {
    definition: {
      name: 'qualify_lead',
      description: 'Mark a lead as QUALIFIED. Logs the activity and bumps the score.',
      parameters: {
        type: 'object',
        properties: { leadId: { type: 'string' }, reason: { type: 'string' } },
        required: ['leadId'],
      },
    },
    execute: async (args, companyId) => {
      const lead = await leadsService.updateStatus(companyId, args.leadId as string, 'QUALIFIED', AI_ACTOR, args.reason as string | undefined);
      return `Qualified lead "${lead.title}" — score now ${lead.score}`;
    },
  },
  {
    definition: {
      name: 'disqualify_lead',
      description: 'Mark a lead as DISQUALIFIED with a reason.',
      parameters: {
        type: 'object',
        properties: { leadId: { type: 'string' }, reason: { type: 'string' } },
        required: ['leadId', 'reason'],
      },
    },
    execute: async (args, companyId) => {
      const lead = await leadsService.updateStatus(companyId, args.leadId as string, 'DISQUALIFIED', AI_ACTOR, args.reason as string);
      return `Disqualified lead "${lead.title}": ${args.reason as string}`;
    },
  },
  {
    definition: {
      name: 'mark_lead_won',
      description: 'Mark a lead as WON. Consider also calling convert_lead_to_deal afterwards.',
      parameters: { type: 'object', properties: { leadId: { type: 'string' } }, required: ['leadId'] },
    },
    execute: async (args, companyId) => {
      const lead = await leadsService.updateStatus(companyId, args.leadId as string, 'WON', AI_ACTOR);
      return `Marked lead "${lead.title}" as WON`;
    },
  },
  {
    definition: {
      name: 'mark_lead_lost',
      description: 'Mark a lead as LOST with a reason.',
      parameters: {
        type: 'object',
        properties: { leadId: { type: 'string' }, reason: { type: 'string' } },
        required: ['leadId', 'reason'],
      },
    },
    execute: async (args, companyId) => {
      const lead = await leadsService.updateStatus(companyId, args.leadId as string, 'LOST', AI_ACTOR, args.reason as string);
      return `Marked lead "${lead.title}" as LOST: ${args.reason as string}`;
    },
  },
  {
    definition: {
      name: 'convert_lead_to_deal',
      description: 'Convert a lead into a Deal in the pipeline. Marks the lead WON and creates a linked deal record.',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string' },
          dealTitle: { type: 'string' },
          value: { type: 'number' },
          currency: { type: 'string' },
          stage: { type: 'string', enum: ['LEAD_IN', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] },
          probability: { type: 'number' },
        },
        required: ['leadId'],
      },
    },
    execute: async (args, companyId) => {
      const result = await leadsService.convertToDeal(
        companyId,
        args.leadId as string,
        {
          dealTitle: args.dealTitle as string | undefined,
          value: args.value as number | undefined,
          currency: args.currency as string | undefined,
          stage: args.stage as never,
          probability: args.probability as number | undefined,
        },
        AI_ACTOR,
      );
      return `Converted lead → deal ${result.dealId}`;
    },
  },
  {
    definition: {
      name: 'add_lead_note',
      description: 'Add a note to a lead. The note appears in the timeline AND is appended to the legacy notes field.',
      parameters: {
        type: 'object',
        properties: { leadId: { type: 'string' }, body: { type: 'string' } },
        required: ['leadId', 'body'],
      },
    },
    execute: async (args, companyId) => {
      await leadsService.addNote(companyId, args.leadId as string, args.body as string, AI_ACTOR);
      return `Note added to lead ${args.leadId as string}`;
    },
  },
  {
    definition: {
      name: 'assign_lead',
      description: 'Assign a lead to a user. Pass userId="null" to unassign.',
      parameters: {
        type: 'object',
        properties: { leadId: { type: 'string' }, userId: { type: 'string' } },
        required: ['leadId', 'userId'],
      },
    },
    execute: async (args, companyId) => {
      const userId = (args.userId as string) === 'null' ? null : (args.userId as string);
      const lead = await leadsService.assign(companyId, args.leadId as string, userId, AI_ACTOR);
      return userId ? `Assigned lead "${lead.title}" to user ${userId}` : `Unassigned lead "${lead.title}"`;
    },
  },
  {
    definition: {
      name: 'score_lead',
      description: 'Manually adjust a lead score by `delta` (positive or negative). Use this when you have qualitative info the rule engine can\'t see.',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string' },
          delta: { type: 'number', description: 'Score delta (-100 to +100)' },
          reason: { type: 'string' },
        },
        required: ['leadId', 'delta', 'reason'],
      },
    },
    execute: async (args, companyId) => {
      const lead = await leadsService.setScore(
        companyId,
        args.leadId as string,
        args.delta as number,
        args.reason as string,
        'ai',
        AI_ACTOR,
      );
      return `Lead "${lead.title}" score is now ${lead.score}`;
    },
  },
  {
    definition: {
      name: 'recalculate_lead_score',
      description: 'Re-run the deterministic scoring rule engine for a lead.',
      parameters: { type: 'object', properties: { leadId: { type: 'string' } }, required: ['leadId'] },
    },
    execute: async (args, companyId) => {
      const lead = await leadsService.recalculateScore(companyId, args.leadId as string);
      return `Recalculated. Score: ${lead.score}`;
    },
  },
  {
    definition: {
      name: 'get_lead_timeline',
      description: 'Fetch the activity timeline of a lead (newest first).',
      parameters: {
        type: 'object',
        properties: { leadId: { type: 'string' }, limit: { type: 'number' } },
        required: ['leadId'],
      },
    },
    execute: async (args, companyId) => {
      const items = await leadsService.getTimeline(companyId, args.leadId as string, (args.limit as number) ?? 20);
      if (!items.length) return 'No timeline activity yet.';
      return items
        .map((a) => `- ${a.createdAt.toISOString().slice(0, 16)} [${a.type}] ${a.title}${a.body ? `\n    ${a.body}` : ''}`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'get_lead_score_history',
      description: 'Show how a lead\'s score evolved over time.',
      parameters: { type: 'object', properties: { leadId: { type: 'string' } }, required: ['leadId'] },
    },
    execute: async (args, companyId) => {
      const events = await leadsService.getScoreHistory(companyId, args.leadId as string);
      if (!events.length) return 'No score history yet.';
      return events
        .map((e) => `${e.createdAt.toISOString().slice(0, 16)}  ${e.delta > 0 ? '+' : ''}${e.delta} → ${e.newScore}  (${e.source}) ${e.reason}`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'find_duplicate_leads',
      description: 'Find existing leads for a contact (by contactId). Use before creating a new lead.',
      parameters: { type: 'object', properties: { contactId: { type: 'string' } }, required: ['contactId'] },
    },
    execute: async (args, companyId) => {
      const dups = await leadsService.findDuplicates(companyId, args.contactId as string);
      if (!dups.length) return 'No existing leads for this contact.';
      return dups.map((d) => `- "${d.title}" | ${d.status} | score ${d.score} | ${d.createdAt.toISOString().slice(0, 10)} | ID: ${d.id}`).join('\n');
    },
  },
  {
    definition: {
      name: 'set_lead_priority',
      description: 'Set lead priority.',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        },
        required: ['leadId', 'priority'],
      },
    },
    execute: async (args, companyId) => {
      const lead = await leadsService.update(companyId, args.leadId as string, { priority: args.priority as never }, AI_ACTOR);
      return `Set priority of "${lead.title}" to ${lead.priority}`;
    },
  },
  {
    definition: {
      name: 'set_lead_next_action',
      description: 'Schedule the next action for a lead — when to follow up and what to do.',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string' },
          when: { type: 'string', description: 'ISO datetime' },
          note: { type: 'string' },
        },
        required: ['leadId', 'when'],
      },
    },
    execute: async (args, companyId) => {
      const lead = await leadsService.update(
        companyId,
        args.leadId as string,
        { nextActionAt: args.when as string, nextActionNote: args.note as string | undefined },
        AI_ACTOR,
      );
      return `Next action for "${lead.title}" set for ${lead.nextActionAt?.toISOString().slice(0, 16)}`;
    },
  },
  {
    definition: {
      name: 'tag_lead',
      description: 'Add or remove tags from a lead.',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string' },
          add: { type: 'array', items: { type: 'string' } },
          remove: { type: 'array', items: { type: 'string' } },
        },
        required: ['leadId'],
      },
    },
    execute: async (args, companyId) => {
      const result = await leadsService.bulkTag(
        companyId,
        [args.leadId as string],
        (args.add as string[]) ?? [],
        (args.remove as string[]) ?? [],
        AI_ACTOR,
      );
      return result.updated ? `Tagged lead ${args.leadId as string}` : 'No changes';
    },
  },
  {
    definition: {
      name: 'bulk_update_lead_status',
      description: 'Move many leads to the same status at once.',
      parameters: {
        type: 'object',
        properties: {
          leadIds: { type: 'array', items: { type: 'string' } },
          status: { type: 'string', enum: ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'NEGOTIATING', 'WON', 'LOST', 'DISQUALIFIED'] },
          reason: { type: 'string' },
        },
        required: ['leadIds', 'status'],
      },
    },
    execute: async (args, companyId) => {
      const result = await leadsService.bulkUpdateStatus(
        companyId,
        args.leadIds as string[],
        args.status as never,
        AI_ACTOR,
        args.reason as string | undefined,
      );
      return `Bulk status: ${result.updated}/${result.requested} updated`;
    },
  },
  {
    definition: {
      name: 'bulk_assign_leads',
      description: 'Assign many leads to one user at once.',
      parameters: {
        type: 'object',
        properties: {
          leadIds: { type: 'array', items: { type: 'string' } },
          userId: { type: 'string' },
        },
        required: ['leadIds', 'userId'],
      },
    },
    execute: async (args, companyId) => {
      const userId = (args.userId as string) === 'null' ? null : (args.userId as string);
      const result = await leadsService.bulkAssign(companyId, args.leadIds as string[], userId, AI_ACTOR);
      return `Bulk assign: ${result.updated}/${result.requested} updated`;
    },
  },
  {
    definition: {
      name: 'bulk_delete_leads',
      description: 'Soft-delete many leads at once.',
      parameters: {
        type: 'object',
        properties: { leadIds: { type: 'array', items: { type: 'string' } } },
        required: ['leadIds'],
      },
    },
    execute: async (args, companyId) => {
      const result = await leadsService.bulkDelete(companyId, args.leadIds as string[], AI_ACTOR);
      return `Bulk delete: ${result.deleted}/${result.requested} removed`;
    },
  },
  {
    definition: {
      name: 'get_lead_stats',
      description: 'Pipeline funnel stats — counts per status, conversion rate, won value, source breakdown.',
      parameters: {
        type: 'object',
        properties: { days: { type: 'number', description: 'Look-back window in days (default 30)' } },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      const s = await leadsService.stats(companyId, (args.days as number) ?? 30);
      return [
        `Lead stats — last ${s.rangeDays} days`,
        `Total: ${s.total}`,
        `Won: ${s.wonCount} (₹${s.wonValue}, ${s.conversionRate}% conversion)`,
        `Avg score: ${s.avgScore}`,
        `By status: ${Object.entries(s.byStatus).map(([k, v]) => `${k}=${v}`).join(', ')}`,
        `By source: ${Object.entries(s.bySource).map(([k, v]) => `${k}=${v}`).join(', ')}`,
      ].join('\n');
    },
  },

  // ── Deals (full lifecycle, all routed through DealsService) ───────────────
  {
    definition: {
      name: 'list_deals',
      description: 'List deals with rich filters. Use this to find deals by stage, source, priority, value, probability, or text search. Always prefer this over reading deals ad-hoc.',
      parameters: {
        type: 'object',
        properties: {
          stage: { type: 'string', enum: ['LEAD_IN', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] },
          source: { type: 'string', enum: ['LEAD_CONVERSION', 'WHATSAPP', 'MANUAL', 'AI_CHAT', 'REFERRAL', 'CAMPAIGN', 'WEBSITE', 'IMPORT', 'OTHER'] },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          assignedAgentId: { type: 'string', description: 'User ID of the assignee, or "null" for unassigned' },
          tag: { type: 'string' },
          search: { type: 'string', description: 'Free-text search over title/notes/contact name/phone' },
          valueMin: { type: 'number' },
          probabilityMin: { type: 'number' },
          nextActionDue: { type: 'boolean', description: 'Only return deals with overdue next-action' },
          sort: { type: 'string', enum: ['recent', 'value', 'probability', 'next_action', 'expected_close', 'created'] },
          limit: { type: 'number' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      const result = await dealsService.list(companyId, {
        stage: args.stage as never,
        source: args.source as never,
        priority: args.priority as never,
        assignedAgentId: args.assignedAgentId === 'null' ? null : (args.assignedAgentId as string | undefined),
        tag: args.tag as string | undefined,
        search: args.search as string | undefined,
        valueMin: args.valueMin as number | undefined,
        probabilityMin: args.probabilityMin as number | undefined,
        nextActionDue: args.nextActionDue as boolean | undefined,
        sort: args.sort as never,
        limit: (args.limit as number) ?? 20,
      });
      if (!result.items.length) return 'No deals match those filters.';
      return [
        `Found ${result.total} deal(s) (showing ${result.items.length}):`,
        ...result.items.map((d) => {
          const contact = d.contact?.displayName ?? d.contact?.phoneNumber ?? '—';
          return `- "${d.title}" | ${d.stage} | ${d.priority} | ${d.currency} ${d.value} (${d.probability}%) | ${contact} | ID: ${d.id}`;
        }),
      ].join('\n');
    },
  },
  {
    definition: {
      name: 'get_deal',
      description: 'Fetch a deal with its last 10 timeline activities, line items, payments, and tasks.',
      parameters: {
        type: 'object',
        properties: { dealId: { type: 'string' } },
        required: ['dealId'],
      },
    },
    execute: async (args, companyId) => {
      const deal = await dealsService.get(companyId, args.dealId as string);
      const recent = deal.activities.slice(0, 10);
      const lines = [
        `Deal "${deal.title}" (ID: ${deal.id})`,
        `Stage: ${deal.stage} · Priority: ${deal.priority} · Probability: ${deal.probability}% · Value: ${deal.currency} ${deal.value}`,
        `Source: ${deal.source} · Tags: ${deal.tags.join(', ') || '—'}`,
        `Contact: ${deal.contact.displayName ?? deal.contact.phoneNumber} (${deal.contact.phoneNumber})`,
        deal.assignedAgent ? `Assigned to: ${deal.assignedAgent.firstName} ${deal.assignedAgent.lastName}` : 'Unassigned',
        deal.expectedCloseAt ? `Expected close: ${deal.expectedCloseAt.toISOString().slice(0, 10)}` : '',
        deal.nextActionAt ? `Next action: ${deal.nextActionAt.toISOString().slice(0, 16)} — ${deal.nextActionNote ?? ''}` : '',
        deal.lineItems.length > 0 ? `Line items: ${deal.lineItems.length} (total ${deal.lineItems.reduce((a, i) => a + i.total, 0)})` : '',
        deal.payments.length > 0 ? `Payments: ${deal.payments.length}` : '',
        '',
        'Recent activity:',
        ...recent.map((a) => `  • ${a.createdAt.toISOString().slice(0, 16)} [${a.type}] ${a.title}`),
      ].filter(Boolean);
      return lines.join('\n');
    },
  },
  {
    definition: {
      name: 'create_deal',
      description: 'Create a new deal in the pipeline. Auto-creates a contact from `phoneNumber` if needed.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          value: { type: 'number' },
          contactId: { type: 'string' },
          phoneNumber: { type: 'string', description: 'Used if no contactId — upserts a contact' },
          contactName: { type: 'string' },
          leadId: { type: 'string', description: 'Optional source lead' },
          stage: { type: 'string', enum: ['LEAD_IN', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION'] },
          source: { type: 'string', enum: ['LEAD_CONVERSION', 'WHATSAPP', 'MANUAL', 'AI_CHAT', 'REFERRAL', 'CAMPAIGN', 'WEBSITE', 'IMPORT', 'OTHER'] },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          probability: { type: 'number' },
          currency: { type: 'string' },
          expectedCloseAt: { type: 'string', description: 'ISO date' },
          tags: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
        required: ['title', 'value'],
      },
    },
    execute: async (args, companyId) => {
      const deal = await dealsService.create(
        companyId,
        {
          title: args.title as string,
          value: args.value as number,
          contactId: args.contactId as string | undefined,
          phoneNumber: args.phoneNumber as string | undefined,
          contactName: args.contactName as string | undefined,
          leadId: args.leadId as string | undefined,
          stage: args.stage as never,
          source: args.source as never,
          priority: args.priority as never,
          probability: args.probability as number | undefined,
          currency: args.currency as string | undefined,
          expectedCloseAt: args.expectedCloseAt as string | undefined,
          tags: args.tags as string[] | undefined,
          notes: args.notes as string | undefined,
        },
        AI_DEAL_ACTOR,
      );
      return `Created deal "${deal.title}" (ID: ${deal.id}, stage: ${deal.stage}, value: ${deal.currency} ${deal.value}, probability: ${deal.probability}%)`;
    },
  },
  {
    definition: {
      name: 'update_deal',
      description: 'Update arbitrary deal fields. Field-level changes are diffed and logged. Use `move_deal_stage` for stage changes.',
      parameters: {
        type: 'object',
        properties: {
          dealId: { type: 'string' },
          title: { type: 'string' },
          value: { type: 'number' },
          probability: { type: 'number' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          tags: { type: 'array', items: { type: 'string' } },
          expectedCloseAt: { type: 'string' },
          nextActionAt: { type: 'string' },
          nextActionNote: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['dealId'],
      },
    },
    execute: async (args, companyId) => {
      const deal = await dealsService.update(
        companyId,
        args.dealId as string,
        {
          title: args.title as string | undefined,
          value: args.value as number | undefined,
          probability: args.probability as number | undefined,
          priority: args.priority as never,
          tags: args.tags as string[] | undefined,
          expectedCloseAt: args.expectedCloseAt as string | undefined,
          nextActionAt: args.nextActionAt as string | undefined,
          nextActionNote: args.nextActionNote as string | undefined,
          notes: args.notes as string | undefined,
        },
        AI_DEAL_ACTOR,
      );
      return `Updated deal "${deal.title}" (stage: ${deal.stage}, value: ${deal.value}, probability: ${deal.probability}%)`;
    },
  },
  {
    definition: {
      name: 'move_deal_stage',
      description: 'Move a deal to a new pipeline stage. Pass `lossReason` from the enum when moving to LOST.',
      parameters: {
        type: 'object',
        properties: {
          dealId: { type: 'string' },
          stage: { type: 'string', enum: ['LEAD_IN', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] },
          lossReason: { type: 'string', enum: ['PRICE', 'COMPETITOR', 'TIMING', 'NO_BUDGET', 'NO_DECISION', 'WRONG_FIT', 'GHOSTED', 'OTHER'] },
          lossReasonText: { type: 'string', description: 'Free-text loss explanation' },
        },
        required: ['dealId', 'stage'],
      },
    },
    execute: async (args, companyId) => {
      const deal = await dealsService.moveStage(
        companyId,
        args.dealId as string,
        {
          stage: args.stage as never,
          lossReason: args.lossReason as never,
          lossReasonText: args.lossReasonText as string | undefined,
        },
        AI_DEAL_ACTOR,
      );
      return `Moved "${deal.title}" → ${deal.stage} (probability: ${deal.probability}%)`;
    },
  },
  {
    definition: {
      name: 'mark_deal_won',
      description: 'Convenience wrapper: move a deal to WON.',
      parameters: { type: 'object', properties: { dealId: { type: 'string' } }, required: ['dealId'] },
    },
    execute: async (args, companyId) => {
      const deal = await dealsService.moveStage(companyId, args.dealId as string, { stage: 'WON' }, AI_DEAL_ACTOR);
      return `Won "${deal.title}" — sales cycle ${deal.salesCycleDays ?? '?'} days`;
    },
  },
  {
    definition: {
      name: 'mark_deal_lost',
      description: 'Mark a deal as LOST with a taxonomic reason. ALWAYS pass a reason from the enum.',
      parameters: {
        type: 'object',
        properties: {
          dealId: { type: 'string' },
          reason: { type: 'string', enum: ['PRICE', 'COMPETITOR', 'TIMING', 'NO_BUDGET', 'NO_DECISION', 'WRONG_FIT', 'GHOSTED', 'OTHER'] },
          note: { type: 'string', description: 'Free-text explanation' },
        },
        required: ['dealId', 'reason'],
      },
    },
    execute: async (args, companyId) => {
      const deal = await dealsService.moveStage(
        companyId,
        args.dealId as string,
        { stage: 'LOST', lossReason: args.reason as never, lossReasonText: args.note as string | undefined },
        AI_DEAL_ACTOR,
      );
      return `Lost "${deal.title}": ${args.reason as string}`;
    },
  },
  {
    definition: {
      name: 'reopen_deal',
      description: 'Reopen a closed (WON or LOST) deal — moves it back to NEGOTIATION.',
      parameters: {
        type: 'object',
        properties: { dealId: { type: 'string' }, reason: { type: 'string' } },
        required: ['dealId', 'reason'],
      },
    },
    execute: async (args, companyId) => {
      const deal = await dealsService.reopen(companyId, args.dealId as string, args.reason as string, AI_DEAL_ACTOR);
      return `Reopened "${deal.title}" → ${deal.stage}`;
    },
  },
  {
    definition: {
      name: 'add_deal_note',
      description: 'Add a note to a deal. Appears in the timeline AND is appended to the legacy notes field.',
      parameters: {
        type: 'object',
        properties: { dealId: { type: 'string' }, body: { type: 'string' } },
        required: ['dealId', 'body'],
      },
    },
    execute: async (args, companyId) => {
      await dealsService.addNote(companyId, args.dealId as string, args.body as string, AI_DEAL_ACTOR);
      return `Note added to deal ${args.dealId as string}`;
    },
  },
  {
    definition: {
      name: 'assign_deal',
      description: 'Assign a deal to a user. Pass userId="null" to unassign.',
      parameters: {
        type: 'object',
        properties: { dealId: { type: 'string' }, userId: { type: 'string' } },
        required: ['dealId', 'userId'],
      },
    },
    execute: async (args, companyId) => {
      const userId = (args.userId as string) === 'null' ? null : (args.userId as string);
      const deal = await dealsService.assign(companyId, args.dealId as string, userId, AI_DEAL_ACTOR);
      return userId ? `Assigned deal "${deal.title}" to user ${userId}` : `Unassigned deal "${deal.title}"`;
    },
  },
  {
    definition: {
      name: 'set_deal_probability',
      description: 'Set a deal\'s win probability (0-100). Use this when you have qualitative info the stage default doesn\'t capture.',
      parameters: {
        type: 'object',
        properties: {
          dealId: { type: 'string' },
          probability: { type: 'number' },
          reason: { type: 'string' },
        },
        required: ['dealId', 'probability', 'reason'],
      },
    },
    execute: async (args, companyId) => {
      const deal = await dealsService.setProbability(
        companyId,
        args.dealId as string,
        args.probability as number,
        args.reason as string,
        AI_DEAL_ACTOR,
      );
      return `Deal "${deal.title}" probability is now ${deal.probability}%`;
    },
  },
  {
    definition: {
      name: 'set_deal_priority',
      description: 'Set the priority of a deal.',
      parameters: {
        type: 'object',
        properties: {
          dealId: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        },
        required: ['dealId', 'priority'],
      },
    },
    execute: async (args, companyId) => {
      const deal = await dealsService.update(companyId, args.dealId as string, { priority: args.priority as never }, AI_DEAL_ACTOR);
      return `Set priority of "${deal.title}" to ${deal.priority}`;
    },
  },
  {
    definition: {
      name: 'set_deal_next_action',
      description: 'Schedule the next action for a deal.',
      parameters: {
        type: 'object',
        properties: {
          dealId: { type: 'string' },
          when: { type: 'string', description: 'ISO datetime' },
          note: { type: 'string' },
        },
        required: ['dealId', 'when'],
      },
    },
    execute: async (args, companyId) => {
      const deal = await dealsService.update(
        companyId,
        args.dealId as string,
        { nextActionAt: args.when as string, nextActionNote: args.note as string | undefined },
        AI_DEAL_ACTOR,
      );
      return `Next action for "${deal.title}" set for ${deal.nextActionAt?.toISOString().slice(0, 16)}`;
    },
  },
  {
    definition: {
      name: 'tag_deal',
      description: 'Add or remove tags from a deal.',
      parameters: {
        type: 'object',
        properties: {
          dealId: { type: 'string' },
          add: { type: 'array', items: { type: 'string' } },
          remove: { type: 'array', items: { type: 'string' } },
        },
        required: ['dealId'],
      },
    },
    execute: async (args, companyId) => {
      const result = await dealsService.bulkTag(
        companyId,
        [args.dealId as string],
        (args.add as string[]) ?? [],
        (args.remove as string[]) ?? [],
        AI_DEAL_ACTOR,
      );
      return result.updated ? `Tagged deal ${args.dealId as string}` : 'No changes';
    },
  },
  {
    definition: {
      name: 'get_deal_timeline',
      description: 'Fetch the activity timeline of a deal (newest first).',
      parameters: {
        type: 'object',
        properties: { dealId: { type: 'string' }, limit: { type: 'number' } },
        required: ['dealId'],
      },
    },
    execute: async (args, companyId) => {
      const items = await dealsService.getTimeline(companyId, args.dealId as string, (args.limit as number) ?? 20);
      if (!items.length) return 'No timeline activity yet.';
      return items
        .map((a) => `- ${a.createdAt.toISOString().slice(0, 16)} [${a.type}] ${a.title}${a.body ? `\n    ${a.body}` : ''}`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'add_deal_line_item',
      description: 'Add a product/service line item to a deal. Total is auto-computed from quantity, unit price, discount %, and tax %.',
      parameters: {
        type: 'object',
        properties: {
          dealId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          quantity: { type: 'number' },
          unitPrice: { type: 'number' },
          discount: { type: 'number', description: 'Percent 0-100' },
          taxRate: { type: 'number', description: 'Percent 0-100' },
          productId: { type: 'string', description: 'Optional link to a Product' },
        },
        required: ['dealId', 'name', 'unitPrice'],
      },
    },
    execute: async (args, companyId) => {
      const item = await dealsService.addLineItem(
        companyId,
        args.dealId as string,
        {
          name: args.name as string,
          description: args.description as string | undefined,
          quantity: args.quantity as number | undefined,
          unitPrice: args.unitPrice as number,
          discount: args.discount as number | undefined,
          taxRate: args.taxRate as number | undefined,
          productId: args.productId as string | undefined,
        },
        AI_DEAL_ACTOR,
      );
      return `Added line item "${item.name}" to deal ${args.dealId as string} (total: ${item.total})`;
    },
  },
  {
    definition: {
      name: 'remove_deal_line_item',
      description: 'Remove a line item from a deal.',
      parameters: {
        type: 'object',
        properties: { dealId: { type: 'string' }, itemId: { type: 'string' } },
        required: ['dealId', 'itemId'],
      },
    },
    execute: async (args, companyId) => {
      await dealsService.removeLineItem(companyId, args.dealId as string, args.itemId as string, AI_DEAL_ACTOR);
      return `Removed line item ${args.itemId as string}`;
    },
  },
  {
    definition: {
      name: 'list_deal_line_items',
      description: 'List all line items for a deal.',
      parameters: {
        type: 'object',
        properties: { dealId: { type: 'string' } },
        required: ['dealId'],
      },
    },
    execute: async (args, companyId) => {
      const items = await dealsService.getLineItems(companyId, args.dealId as string);
      if (!items.length) return 'No line items.';
      return items
        .map((i) => `- ${i.name} | qty ${i.quantity} × ${i.unitPrice} - ${i.discount}% disc + ${i.taxRate}% tax = ${i.total} (${i.id})`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'bulk_move_deal_stage',
      description: 'Move many deals to the same stage at once.',
      parameters: {
        type: 'object',
        properties: {
          dealIds: { type: 'array', items: { type: 'string' } },
          stage: { type: 'string', enum: ['LEAD_IN', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] },
          lossReason: { type: 'string', enum: ['PRICE', 'COMPETITOR', 'TIMING', 'NO_BUDGET', 'NO_DECISION', 'WRONG_FIT', 'GHOSTED', 'OTHER'] },
        },
        required: ['dealIds', 'stage'],
      },
    },
    execute: async (args, companyId) => {
      const result = await dealsService.bulkMoveStage(
        companyId,
        args.dealIds as string[],
        args.stage as never,
        AI_DEAL_ACTOR,
        args.lossReason as never,
      );
      return `Bulk stage: ${result.updated}/${result.requested} updated`;
    },
  },
  {
    definition: {
      name: 'bulk_assign_deals',
      description: 'Assign many deals to one user at once.',
      parameters: {
        type: 'object',
        properties: {
          dealIds: { type: 'array', items: { type: 'string' } },
          userId: { type: 'string' },
        },
        required: ['dealIds', 'userId'],
      },
    },
    execute: async (args, companyId) => {
      const userId = (args.userId as string) === 'null' ? null : (args.userId as string);
      const result = await dealsService.bulkAssign(companyId, args.dealIds as string[], userId, AI_DEAL_ACTOR);
      return `Bulk assign: ${result.updated}/${result.requested} updated`;
    },
  },
  {
    definition: {
      name: 'bulk_delete_deals',
      description: 'Soft-delete many deals at once.',
      parameters: {
        type: 'object',
        properties: { dealIds: { type: 'array', items: { type: 'string' } } },
        required: ['dealIds'],
      },
    },
    execute: async (args, companyId) => {
      const result = await dealsService.bulkDelete(companyId, args.dealIds as string[], AI_DEAL_ACTOR);
      return `Bulk delete: ${result.deleted}/${result.requested} removed`;
    },
  },
  {
    definition: {
      name: 'get_deal_forecast',
      description: 'Pipeline forecast — weighted/unweighted value, by stage, by source, conversion rate, average sales cycle, top open deals, loss reasons. Call this when the user asks "how is the pipeline" or "what\'s the forecast".',
      parameters: {
        type: 'object',
        properties: { days: { type: 'number', description: 'Look-back window in days (default 30)' } },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      const f = await dealsService.forecast(companyId, (args.days as number) ?? 30);
      const stages = (Object.keys(f.byStage) as (keyof typeof f.byStage)[])
        .map((s) => `${s}=${f.byStage[s].count}/₹${Math.round(f.byStage[s].value)}`)
        .join(', ');
      return [
        `Pipeline forecast — last ${f.rangeDays} days`,
        `Total deals: ${f.totalDeals} (${f.openDeals} open)`,
        `Pipeline value: ₹${Math.round(f.pipelineValueRaw)} raw / ₹${Math.round(f.pipelineValueWeighted)} weighted`,
        `Won: ${f.wonCount} (₹${Math.round(f.wonValue)}) — conversion ${f.conversionRate}%`,
        `Lost: ${f.lostCount} (₹${Math.round(f.lostValue)})`,
        `Avg sales cycle: ${f.avgSalesCycleDays} days`,
        `By stage: ${stages}`,
        f.topOpenDeals.length ? `Top open: ${f.topOpenDeals.map((d) => `"${d.title}" ₹${d.value}`).join(', ')}` : '',
      ].filter(Boolean).join('\n');
    },
  },
  {
    definition: {
      name: 'find_deals_by_contact',
      description: 'Find all deals attached to a specific contact.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          phoneNumber: { type: 'string' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      let contactId = args.contactId as string | undefined;
      if (!contactId && args.phoneNumber) {
        const phone = (args.phoneNumber as string).replace(/[\s\-+()]/g, '');
        const c = await prisma.contact.findFirst({ where: { companyId, phoneNumber: phone } });
        contactId = c?.id;
      }
      if (!contactId) return 'No contact found';
      const result = await dealsService.list(companyId, { contactId, limit: 50 });
      if (!result.items.length) return 'No deals for this contact.';
      return result.items.map((d) => `- "${d.title}" | ${d.stage} | ${d.currency} ${d.value} (${d.probability}%) | ID: ${d.id}`).join('\n');
    },
  },

  // ── Tasks (full lifecycle, all routed through TasksService) ───────────────
  {
    definition: {
      name: 'list_tasks',
      description: 'List tasks with rich filters. Use this to find tasks by status, priority, source, assignee, contact/deal/lead, due date range, or text search. Pass `assignedToMe: true` for "my tasks". Pass `overdue: true` to get only overdue tasks.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'] },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          source: { type: 'string', enum: ['MANUAL', 'AI_CHAT', 'WHATSAPP', 'RECURRING', 'AUTO_FOLLOW_UP', 'IMPORT', 'OTHER'] },
          assignedAgentId: { type: 'string', description: 'User ID, or "null" for unassigned' },
          assignedToMe: { type: 'boolean', description: 'Resolve to the current user (NOTE: AI tools have no "current user" so prefer assignedAgentId)' },
          contactId: { type: 'string' },
          dealId: { type: 'string' },
          leadId: { type: 'string' },
          parentTaskId: { type: 'string' },
          tag: { type: 'string' },
          dueFrom: { type: 'string', description: 'ISO datetime' },
          dueTo: { type: 'string', description: 'ISO datetime' },
          overdue: { type: 'boolean' },
          search: { type: 'string' },
          sort: { type: 'string', enum: ['recent', 'due', 'priority', 'created'] },
          limit: { type: 'number' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      const result = await tasksService.list(companyId, {
        status: args.status as never,
        priority: args.priority as never,
        source: args.source as never,
        assignedAgentId: args.assignedAgentId === 'null' ? null : (args.assignedAgentId as string | undefined),
        contactId: args.contactId as string | undefined,
        dealId: args.dealId as string | undefined,
        leadId: args.leadId as string | undefined,
        parentTaskId: args.parentTaskId as string | undefined,
        tag: args.tag as string | undefined,
        dueFrom: args.dueFrom as string | undefined,
        dueTo: args.dueTo as string | undefined,
        overdue: args.overdue as boolean | undefined,
        search: args.search as string | undefined,
        sort: args.sort as never,
        limit: (args.limit as number) ?? 20,
      });
      if (!result.items.length) return 'No tasks match those filters.';
      return [
        `Found ${result.total} task(s) (showing ${result.items.length}):`,
        ...result.items.map((t) => {
          const due = t.dueAt ? t.dueAt.toISOString().slice(0, 16) : 'no due date';
          const contact = t.contact?.displayName ?? t.contact?.phoneNumber ?? '';
          return `- [${t.priority}] ${t.status} "${t.title}" · ${due}${contact ? ` · ${contact}` : ''} · ID: ${t.id}`;
        }),
      ].join('\n');
    },
  },
  {
    definition: {
      name: 'get_task',
      description: 'Fetch a task with its subtasks, comments, watchers, and last 10 timeline activities.',
      parameters: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
        required: ['taskId'],
      },
    },
    execute: async (args, companyId) => {
      const task = await tasksService.get(companyId, args.taskId as string);
      const activities = task.activities.slice(0, 10);
      const lines = [
        `Task "${task.title}" (ID: ${task.id})`,
        `Status: ${task.status} · Priority: ${task.priority} · Source: ${task.source}`,
        task.dueAt ? `Due: ${task.dueAt.toISOString().slice(0, 16)}` : 'No due date',
        task.assignedAgent ? `Assigned to: ${task.assignedAgent.firstName} ${task.assignedAgent.lastName}` : 'Unassigned',
        task.contact ? `Contact: ${task.contact.displayName ?? task.contact.phoneNumber}` : '',
        task.deal ? `Deal: ${task.deal.title}` : '',
        task.lead ? `Lead: ${task.lead.title}` : '',
        task.tags.length ? `Tags: ${task.tags.join(', ')}` : '',
        task.estimatedHours ? `Estimated: ${task.estimatedHours}h, Actual: ${task.actualHours ?? 0}h` : '',
        task.subtasks.length ? `Subtasks: ${task.subtasks.filter((s) => s.status === 'DONE').length}/${task.subtasks.length} done` : '',
        task.comments.length ? `Comments: ${task.comments.length}` : '',
        '',
        'Recent activity:',
        ...activities.map((a) => `  • ${a.createdAt.toISOString().slice(0, 16)} [${a.type}] ${a.title}`),
      ].filter(Boolean);
      return lines.join('\n');
    },
  },
  {
    definition: {
      name: 'create_task',
      description: 'Create a new task. Auto-creates a contact from `phoneNumber` if needed. For subtasks pass `parentTaskId`. Defaults: status=TODO, priority=MEDIUM, source=AI_CHAT, reminder 30 min before due.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          dueAt: { type: 'string', description: 'ISO datetime' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          assignedAgentId: { type: 'string' },
          contactId: { type: 'string' },
          phoneNumber: { type: 'string', description: 'Used if no contactId — upserts a contact' },
          contactName: { type: 'string' },
          dealId: { type: 'string' },
          leadId: { type: 'string' },
          parentTaskId: { type: 'string', description: 'Make this a subtask of another task' },
          tags: { type: 'array', items: { type: 'string' } },
          estimatedHours: { type: 'number' },
          reminderOffsets: { type: 'array', items: { type: 'number' }, description: 'Minutes before dueAt to fire reminders, e.g. [60, 30, 5]' },
        },
        required: ['title'],
      },
    },
    execute: async (args, companyId) => {
      const task = await tasksService.create(
        companyId,
        {
          title: args.title as string,
          description: args.description as string | undefined,
          dueAt: args.dueAt as string | undefined,
          priority: args.priority as never,
          assignedAgentId: args.assignedAgentId as string | undefined,
          contactId: args.contactId as string | undefined,
          phoneNumber: args.phoneNumber as string | undefined,
          contactName: args.contactName as string | undefined,
          dealId: args.dealId as string | undefined,
          leadId: args.leadId as string | undefined,
          parentTaskId: args.parentTaskId as string | undefined,
          tags: args.tags as string[] | undefined,
          estimatedHours: args.estimatedHours as number | undefined,
          reminderOffsets: args.reminderOffsets as number[] | undefined,
        },
        AI_TASK_ACTOR,
      );
      return `Created task "${task.title}" (ID: ${task.id}, status: ${task.status}, priority: ${task.priority}${task.dueAt ? `, due ${task.dueAt.toISOString().slice(0, 16)}` : ''})`;
    },
  },
  {
    definition: {
      name: 'update_task',
      description: 'Update arbitrary task fields. Use `mark_task_done` for status changes — never use update_task to change status.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          tags: { type: 'array', items: { type: 'string' } },
          dueAt: { type: 'string' },
          assignedAgentId: { type: 'string' },
          estimatedHours: { type: 'number' },
        },
        required: ['taskId'],
      },
    },
    execute: async (args, companyId) => {
      const task = await tasksService.update(
        companyId,
        args.taskId as string,
        {
          title: args.title as string | undefined,
          description: args.description as string | undefined,
          priority: args.priority as never,
          tags: args.tags as string[] | undefined,
          dueAt: args.dueAt as string | undefined,
          assignedAgentId: args.assignedAgentId as string | undefined,
          estimatedHours: args.estimatedHours as number | undefined,
        },
        AI_TASK_ACTOR,
      );
      return `Updated task "${task.title}"`;
    },
  },
  {
    definition: {
      name: 'mark_task_done',
      description: 'Mark a task as DONE. Cascades to all subtasks. If part of a recurring series, automatically spawns the next instance.',
      parameters: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
        required: ['taskId'],
      },
    },
    execute: async (args, companyId) => {
      const task = await tasksService.updateStatus(companyId, args.taskId as string, 'DONE', AI_TASK_ACTOR);
      return `Marked "${task.title}" as DONE`;
    },
  },
  {
    definition: {
      name: 'start_task',
      description: 'Move a task to IN_PROGRESS (records startedAt for cycle-time analytics).',
      parameters: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
    },
    execute: async (args, companyId) => {
      const task = await tasksService.updateStatus(companyId, args.taskId as string, 'IN_PROGRESS', AI_TASK_ACTOR);
      return `Started "${task.title}"`;
    },
  },
  {
    definition: {
      name: 'cancel_task',
      description: 'Cancel a task with a reason. Use this instead of delete_task when there\'s a meaningful reason.',
      parameters: {
        type: 'object',
        properties: { taskId: { type: 'string' }, reason: { type: 'string' } },
        required: ['taskId', 'reason'],
      },
    },
    execute: async (args, companyId) => {
      const task = await tasksService.updateStatus(companyId, args.taskId as string, 'CANCELLED', AI_TASK_ACTOR, args.reason as string);
      return `Cancelled "${task.title}": ${args.reason as string}`;
    },
  },
  {
    definition: {
      name: 'reopen_task',
      description: 'Move a DONE or CANCELLED task back to TODO.',
      parameters: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
    },
    execute: async (args, companyId) => {
      const task = await tasksService.updateStatus(companyId, args.taskId as string, 'TODO', AI_TASK_ACTOR);
      return `Reopened "${task.title}"`;
    },
  },
  {
    definition: {
      name: 'delete_task',
      description: 'Soft-delete a task (sets status to CANCELLED).',
      parameters: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
    },
    execute: async (args, companyId) => {
      await tasksService.remove(companyId, args.taskId as string, AI_TASK_ACTOR);
      return `Deleted task ${args.taskId as string}`;
    },
  },
  {
    definition: {
      name: 'add_task_comment',
      description: 'Post a comment on a task. Comments are separate from the activity timeline — use this for discussion, use the timeline for system events.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          body: { type: 'string' },
          mentions: { type: 'array', items: { type: 'string' }, description: 'User IDs to @mention' },
        },
        required: ['taskId', 'body'],
      },
    },
    execute: async (args, companyId) => {
      await tasksService.addComment(
        companyId,
        args.taskId as string,
        { body: args.body as string, mentions: (args.mentions as string[]) ?? [] },
        AI_TASK_ACTOR,
      );
      return `Comment added to task ${args.taskId as string}`;
    },
  },
  {
    definition: {
      name: 'assign_task',
      description: 'Assign a task to a user. Pass userId="null" to unassign. The new assignee is auto-added as a watcher.',
      parameters: {
        type: 'object',
        properties: { taskId: { type: 'string' }, userId: { type: 'string' } },
        required: ['taskId', 'userId'],
      },
    },
    execute: async (args, companyId) => {
      const userId = (args.userId as string) === 'null' ? null : (args.userId as string);
      const task = await tasksService.assign(companyId, args.taskId as string, userId, AI_TASK_ACTOR);
      return userId ? `Assigned task "${task.title}" to user ${userId}` : `Unassigned task "${task.title}"`;
    },
  },
  {
    definition: {
      name: 'reschedule_task',
      description: 'Change a task\'s due date. Resets the reminder fire history so reminders for the new time fire fresh.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          newDueAt: { type: 'string', description: 'ISO datetime' },
          reason: { type: 'string' },
        },
        required: ['taskId', 'newDueAt'],
      },
    },
    execute: async (args, companyId) => {
      const task = await tasksService.reschedule(
        companyId,
        args.taskId as string,
        args.newDueAt as string,
        args.reason as string | undefined,
        AI_TASK_ACTOR,
      );
      return `Rescheduled "${task.title}" to ${task.dueAt?.toISOString().slice(0, 16)}`;
    },
  },
  {
    definition: {
      name: 'snooze_task',
      description: 'Bump a task\'s due time forward by N minutes from now (or from its current dueAt if it\'s in the future).',
      parameters: {
        type: 'object',
        properties: { taskId: { type: 'string' }, minutes: { type: 'number' } },
        required: ['taskId', 'minutes'],
      },
    },
    execute: async (args, companyId) => {
      const task = await tasksService.snooze(companyId, args.taskId as string, args.minutes as number, AI_TASK_ACTOR);
      return `Snoozed "${task.title}" by ${args.minutes as number}m → due ${task.dueAt?.toISOString().slice(0, 16)}`;
    },
  },
  {
    definition: {
      name: 'log_task_time',
      description: 'Log time spent on a task (in hours). Increments `actualHours`.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          hours: { type: 'number' },
          note: { type: 'string' },
        },
        required: ['taskId', 'hours'],
      },
    },
    execute: async (args, companyId) => {
      const task = await tasksService.logTime(
        companyId,
        args.taskId as string,
        args.hours as number,
        args.note as string | undefined,
        AI_TASK_ACTOR,
      );
      return `Logged ${args.hours as number}h on "${task.title}" (total ${task.actualHours}h)`;
    },
  },
  {
    definition: {
      name: 'set_task_priority',
      description: 'Set a task\'s priority.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        },
        required: ['taskId', 'priority'],
      },
    },
    execute: async (args, companyId) => {
      const task = await tasksService.update(companyId, args.taskId as string, { priority: args.priority as never }, AI_TASK_ACTOR);
      return `Set priority of "${task.title}" to ${task.priority}`;
    },
  },
  {
    definition: {
      name: 'set_task_reminders',
      description: 'Set the reminder offsets (minutes before dueAt) for a task. Replaces existing offsets. Default for new tasks is [30].',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          offsets: { type: 'array', items: { type: 'number' } },
        },
        required: ['taskId', 'offsets'],
      },
    },
    execute: async (args, companyId) => {
      await tasksService.setReminderOffsets(companyId, args.taskId as string, args.offsets as number[], AI_TASK_ACTOR);
      return `Reminder offsets updated to ${(args.offsets as number[]).join(', ')} min`;
    },
  },
  {
    definition: {
      name: 'tag_task',
      description: 'Add or remove tags from a task.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          add: { type: 'array', items: { type: 'string' } },
          remove: { type: 'array', items: { type: 'string' } },
        },
        required: ['taskId'],
      },
    },
    execute: async (args, companyId) => {
      const result = await tasksService.bulkTag(
        companyId,
        [args.taskId as string],
        (args.add as string[]) ?? [],
        (args.remove as string[]) ?? [],
        AI_TASK_ACTOR,
      );
      return result.updated ? `Tagged task ${args.taskId as string}` : 'No changes';
    },
  },
  {
    definition: {
      name: 'add_task_watcher',
      description: 'Add a user as a watcher on a task — they will be notified of status changes.',
      parameters: {
        type: 'object',
        properties: { taskId: { type: 'string' }, userId: { type: 'string' } },
        required: ['taskId', 'userId'],
      },
    },
    execute: async (args, companyId) => {
      await tasksService.addWatcher(companyId, args.taskId as string, args.userId as string, AI_TASK_ACTOR);
      return `Added watcher ${args.userId as string} to task`;
    },
  },
  {
    definition: {
      name: 'add_subtask',
      description: 'Add a subtask to an existing task. The subtask inherits the parent\'s contact / deal / lead context.',
      parameters: {
        type: 'object',
        properties: {
          parentTaskId: { type: 'string' },
          title: { type: 'string' },
          dueAt: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          assignedAgentId: { type: 'string' },
        },
        required: ['parentTaskId', 'title'],
      },
    },
    execute: async (args, companyId) => {
      const task = await tasksService.create(
        companyId,
        {
          parentTaskId: args.parentTaskId as string,
          title: args.title as string,
          dueAt: args.dueAt as string | undefined,
          priority: args.priority as never,
          assignedAgentId: args.assignedAgentId as string | undefined,
        },
        AI_TASK_ACTOR,
      );
      return `Added subtask "${task.title}" (ID: ${task.id})`;
    },
  },
  {
    definition: {
      name: 'get_task_timeline',
      description: 'Fetch the activity timeline of a task (newest first).',
      parameters: {
        type: 'object',
        properties: { taskId: { type: 'string' }, limit: { type: 'number' } },
        required: ['taskId'],
      },
    },
    execute: async (args, companyId) => {
      const items = await tasksService.getTimeline(companyId, args.taskId as string, (args.limit as number) ?? 20);
      if (!items.length) return 'No timeline activity yet.';
      return items
        .map((a) => `- ${a.createdAt.toISOString().slice(0, 16)} [${a.type}] ${a.title}${a.body ? `\n    ${a.body}` : ''}`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'get_task_stats',
      description: 'Task health stats — counts per status, overdue count, completion rate, average cycle time.',
      parameters: {
        type: 'object',
        properties: { days: { type: 'number', description: 'Look-back window in days (default 30)' } },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      const s = await tasksService.stats(companyId, (args.days as number) ?? 30);
      return [
        `Task stats — last ${s.rangeDays} days`,
        `Total: ${s.total}`,
        `Overdue: ${s.overdue}`,
        `Completed recently: ${s.completedRecently}`,
        `Completion rate: ${s.completionRate}%`,
        `Avg cycle: ${s.avgCycleHours}h`,
        `By status: ${Object.entries(s.byStatus).map(([k, v]) => `${k}=${v}`).join(', ')}`,
      ].join('\n');
    },
  },
  {
    definition: {
      name: 'bulk_complete_tasks',
      description: 'Mark many tasks as DONE at once.',
      parameters: {
        type: 'object',
        properties: { taskIds: { type: 'array', items: { type: 'string' } } },
        required: ['taskIds'],
      },
    },
    execute: async (args, companyId) => {
      const result = await tasksService.bulkUpdateStatus(companyId, args.taskIds as string[], 'DONE', AI_TASK_ACTOR);
      return `Bulk complete: ${result.updated}/${result.requested} marked done`;
    },
  },
  {
    definition: {
      name: 'bulk_assign_tasks',
      description: 'Assign many tasks to one user at once.',
      parameters: {
        type: 'object',
        properties: {
          taskIds: { type: 'array', items: { type: 'string' } },
          userId: { type: 'string' },
        },
        required: ['taskIds', 'userId'],
      },
    },
    execute: async (args, companyId) => {
      const userId = (args.userId as string) === 'null' ? null : (args.userId as string);
      const result = await tasksService.bulkAssign(companyId, args.taskIds as string[], userId, AI_TASK_ACTOR);
      return `Bulk assign: ${result.updated}/${result.requested} updated`;
    },
  },
  {
    definition: {
      name: 'bulk_snooze_tasks',
      description: 'Snooze many tasks by the same amount of minutes.',
      parameters: {
        type: 'object',
        properties: {
          taskIds: { type: 'array', items: { type: 'string' } },
          minutes: { type: 'number' },
        },
        required: ['taskIds', 'minutes'],
      },
    },
    execute: async (args, companyId) => {
      const result = await tasksService.bulkSnooze(companyId, args.taskIds as string[], args.minutes as number, AI_TASK_ACTOR);
      return `Bulk snooze: ${result.updated}/${result.requested} updated`;
    },
  },
  {
    definition: {
      name: 'find_tasks_for_contact',
      description: 'Find all tasks linked to a contact (by id or phone).',
      parameters: {
        type: 'object',
        properties: { contactId: { type: 'string' }, phoneNumber: { type: 'string' } },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      let contactId = args.contactId as string | undefined;
      if (!contactId && args.phoneNumber) {
        const phone = (args.phoneNumber as string).replace(/[\s\-+()]/g, '');
        const c = await prisma.contact.findFirst({ where: { companyId, phoneNumber: phone } });
        contactId = c?.id;
      }
      if (!contactId) return 'No contact found';
      const result = await tasksService.list(companyId, { contactId, limit: 50 });
      if (!result.items.length) return 'No tasks for this contact.';
      return result.items.map((t) => `- [${t.priority}] ${t.status} "${t.title}" · ${t.dueAt?.toISOString().slice(0, 16) ?? 'no due'} · ID: ${t.id}`).join('\n');
    },
  },
  {
    definition: {
      name: 'create_recurring_task',
      description: 'Set up a recurring task (daily standup, weekly review, monthly close, etc.). Generates a new Task instance on every cycle. Pass `daysOfWeek` (0=Sun..6=Sat) for WEEKLY, `dayOfMonth` for MONTHLY, `intervalDays` for CUSTOM_DAYS.',
      parameters: {
        type: 'object',
        properties: {
          templateTitle: { type: 'string' },
          templateBody: { type: 'string' },
          templatePriority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          templateAssignedAgentId: { type: 'string' },
          frequency: { type: 'string', enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM_DAYS'] },
          intervalDays: { type: 'number' },
          daysOfWeek: { type: 'array', items: { type: 'number' } },
          dayOfMonth: { type: 'number' },
          startsAt: { type: 'string', description: 'ISO datetime — first instance fires at this time' },
          endsAt: { type: 'string', description: 'Optional — stop generating instances after this date' },
        },
        required: ['templateTitle', 'frequency', 'startsAt'],
      },
    },
    execute: async (args, companyId) => {
      const r = await tasksService.createRecurrence(companyId, {
        templateTitle: args.templateTitle as string,
        templateBody: args.templateBody as string | undefined,
        templatePriority: args.templatePriority as never,
        templateAssignedAgentId: args.templateAssignedAgentId as string | undefined,
        frequency: args.frequency as never,
        intervalDays: args.intervalDays as number | undefined,
        daysOfWeek: args.daysOfWeek as number[] | undefined,
        dayOfMonth: args.dayOfMonth as number | undefined,
        startsAt: args.startsAt as string,
        endsAt: args.endsAt as string | undefined,
      });
      return `Recurring task "${r.templateTitle}" set up — first instance ${r.nextRunAt.toISOString().slice(0, 16)} (${r.frequency})`;
    },
  },
  {
    definition: {
      name: 'list_recurring_tasks',
      description: 'List all recurring task series for this company.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    execute: async (_args, companyId) => {
      const items = await tasksService.listRecurrences(companyId);
      if (!items.length) return 'No recurring tasks set up.';
      return items
        .map((r) => `- "${r.templateTitle}" · ${r.frequency} · next ${r.nextRunAt.toISOString().slice(0, 16)} · ${r.totalGenerated} generated · ${r.isActive ? 'active' : 'paused'} · ID: ${r.id}`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'pause_recurring_task',
      description: 'Pause a recurring task series — no further instances will be generated until you resume it.',
      parameters: {
        type: 'object',
        properties: { recurrenceId: { type: 'string' } },
        required: ['recurrenceId'],
      },
    },
    execute: async (args, companyId) => {
      await tasksService.pauseRecurrence(companyId, args.recurrenceId as string, true);
      return `Paused recurring task ${args.recurrenceId as string}`;
    },
  },

  // ── WhatsApp & Communication ──────────────────────────────────────────────
  {
    definition: {
      name: 'send_whatsapp',
      description: 'Send a WhatsApp message to a contact. Can send plain text, OR forward an attachment the user uploaded in this chat (image, PDF, document, etc.) by setting `attachmentIndex`. When the user attached a file and says "send this to <contact>", call this with the appropriate attachmentIndex (0 for the first attachment).',
      parameters: {
        type: 'object',
        properties: {
          phoneNumber: { type: 'string', description: 'Phone number to send to (with or without country code)' },
          text: { type: 'string', description: 'Message text. When sending an attachment this becomes the caption.' },
          attachmentIndex: {
            type: 'number',
            description: 'Index (0-based) into the user\'s uploaded attachments for THIS message. Omit to send text only. Use 0 if there is exactly one attachment.',
          },
          attachmentName: {
            type: 'string',
            description: 'Alternative to attachmentIndex — match an attachment by file name (case-insensitive substring).',
          },
        },
        required: ['phoneNumber'],
      },
    },
    execute: async (args, companyId, context) => {
      const account = await prisma.whatsAppAccount.findFirst({ where: { companyId, status: 'CONNECTED' } });
      if (!account) return 'No connected WhatsApp account found';

      // Normalize phone number: remove +, spaces, dashes; add 91 prefix for 10-digit Indian numbers
      let phone = (args.phoneNumber as string).replace(/[\s\-\+\(\)]/g, '');
      if (phone.startsWith('0')) phone = '91' + phone.slice(1); // 08714414424 → 918714414424
      if (phone.length === 10 && /^\d+$/.test(phone)) phone = '91' + phone; // 8714414424 → 918714414424

      // Resolve attachment if requested
      const allAtts = context.attachments ?? [];
      let chosen: ChatAttachment | undefined;
      if (typeof args.attachmentIndex === 'number') {
        chosen = allAtts[args.attachmentIndex];
        if (!chosen) {
          return `No attachment at index ${args.attachmentIndex} (user uploaded ${allAtts.length} file${allAtts.length === 1 ? '' : 's'} this turn)`;
        }
      } else if (typeof args.attachmentName === 'string' && args.attachmentName) {
        const needle = args.attachmentName.toLowerCase();
        chosen = allAtts.find((a) => a.fileName.toLowerCase().includes(needle));
        if (!chosen) return `No attachment matching name "${args.attachmentName}"`;
      }

      const text = (args.text as string | undefined)?.trim();

      if (chosen) {
        // Image: stored as base64. Text file: stored as decoded UTF-8 text.
        // For text files we re-encode to base64 so the WhatsApp service can
        // upload to MinIO uniformly.
        let mediaBase64: string;
        const mimeType = chosen.mimeType;
        if (chosen.kind === 'image' && chosen.dataBase64) {
          mediaBase64 = chosen.dataBase64;
        } else if (chosen.kind === 'text' && typeof chosen.text === 'string') {
          mediaBase64 = Buffer.from(chosen.text, 'utf-8').toString('base64');
        } else {
          return `Attachment "${chosen.fileName}" has no payload to send`;
        }

        await redis.publish('wa:outbound', JSON.stringify({
          accountId: account.id,
          toPhone: phone,
          mediaBase64,
          mimeType,
          fileName: chosen.fileName,
          caption: text || undefined,
        }));
        return `Sent ${chosen.kind === 'image' ? 'image' : 'document'} "${chosen.fileName}" to ${phone}${text ? ` with caption "${text.slice(0, 50)}"` : ''}`;
      }

      if (!text) return 'No text or attachment to send';

      await redis.publish('wa:outbound', JSON.stringify({
        accountId: account.id,
        toPhone: phone,
        text,
      }));
      return `Message sent to ${phone}: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`;
    },
  },
  {
    definition: {
      name: 'list_conversations',
      description: 'List recent WhatsApp conversations.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status (OPEN, AI_HANDLING, WAITING_HUMAN, RESOLVED, CLOSED)' },
          limit: { type: 'number' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      const where: Record<string, unknown> = { companyId };
      if (args.status) where.status = args.status;
      const convs = await prisma.conversation.findMany({
        where: where as any,
        take: (args.limit as number) || 10,
        orderBy: { lastMessageAt: 'desc' },
        include: { contact: { select: { displayName: true, phoneNumber: true } } },
      });
      if (!convs.length) return 'No conversations found';
      return convs.map((c) => `- ${c.contact?.displayName || c.contact?.phoneNumber || 'Unknown'} | ${c.status} | AI: ${c.aiEnabled ? 'on' : 'off'} | Last: ${c.lastMessageText?.slice(0, 40) || '...'}`).join('\n');
    },
  },

  // ── Broadcasts ────────────────────────────────────────────────────────────
  // ── Broadcasts (full lifecycle, all routed through BroadcastService) ─────
  {
    definition: {
      name: 'list_broadcasts',
      description: 'List broadcasts with optional filters. Use this to find broadcasts by status, search text, or scheduled date range.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['DRAFT', 'SCHEDULED', 'SENDING', 'COMPLETED', 'CANCELLED', 'PAUSED', 'FAILED'] },
          search: { type: 'string', description: 'Free-text search over name and message' },
          sort: { type: 'string', enum: ['recent', 'scheduled', 'sent_count', 'name'] },
          limit: { type: 'number' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      const result = await broadcastsService.list(companyId, {
        status: args.status as never,
        search: args.search as string | undefined,
        sort: args.sort as never,
        limit: (args.limit as number) ?? 20,
      });
      if (!result.items.length) return 'No broadcasts match those filters.';
      return [
        `Found ${result.total} broadcast(s) (showing ${result.items.length}):`,
        ...result.items.map((b) => {
          const counts = `${b.sentCount}/${b.totalRecipients} sent${b.failedCount > 0 ? `, ${b.failedCount} failed` : ''}`;
          const sched = b.scheduledAt ? ` · sched ${b.scheduledAt.toISOString().slice(0, 16)}` : '';
          return `- [${b.status}] "${b.name}" · ${counts}${sched} · ID: ${b.id}`;
        }),
      ].join('\n');
    },
  },
  {
    definition: {
      name: 'get_broadcast',
      description: 'Fetch a broadcast with its message body, audience size, recipient counts by status, and last 10 timeline activities.',
      parameters: {
        type: 'object',
        properties: { broadcastId: { type: 'string' } },
        required: ['broadcastId'],
      },
    },
    execute: async (args, companyId) => {
      const b = await broadcastsService.get(companyId, args.broadcastId as string);
      const recent = b.activities.slice(0, 10);
      const lines = [
        `Broadcast "${b.name}" (ID: ${b.id})`,
        `Status: ${b.status}`,
        `Message: ${b.message.slice(0, 200)}${b.message.length > 200 ? '...' : ''}`,
        b.mediaUrl ? `Media: ${b.mediaUrl}` : '',
        `Audience: ${b.totalRecipients} recipient${b.totalRecipients === 1 ? '' : 's'}`,
        `Sent: ${b.sentCount} · Failed: ${b.failedCount} · Delivered: ${b.deliveredCount} · Read: ${b.readCount}`,
        b.scheduledAt ? `Scheduled: ${b.scheduledAt.toISOString().slice(0, 16)}` : '',
        b.startedAt ? `Started: ${b.startedAt.toISOString().slice(0, 16)}` : '',
        b.completedAt ? `Completed: ${b.completedAt.toISOString().slice(0, 16)}` : '',
        '',
        'Recent activity:',
        ...recent.map((a) => `  • ${a.createdAt.toISOString().slice(0, 16)} [${a.type}] ${a.title}`),
      ].filter(Boolean);
      return lines.join('\n');
    },
  },
  {
    definition: {
      name: 'create_broadcast',
      description: 'Create a new broadcast (always starts in DRAFT). Use {{firstName}}, {{lastName}}, {{name}}, {{phoneNumber}}, {{email}}, {{company}} for personalization. Pass `audience` to set targeting on creation, `scheduledAt` to schedule.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Internal name (not shown to recipients)' },
          message: { type: 'string', description: 'Message body. Supports {{firstName}}, {{name}}, etc.' },
          mediaUrl: { type: 'string', description: 'Optional image/document URL' },
          mediaType: { type: 'string', enum: ['image', 'document', 'video'] },
          mediaCaption: { type: 'string' },
          variables: { type: 'object', description: 'Default values for template variables' },
          audience: {
            type: 'object',
            description: 'Audience filter — at minimum pass tags or contactIds',
            properties: {
              tags: { type: 'array', items: { type: 'string' } },
              contactIds: { type: 'array', items: { type: 'string' } },
              lifecycleStage: { type: 'string' },
              scoreMin: { type: 'number' },
              hasOpenDeal: { type: 'boolean' },
              hasOpenLead: { type: 'boolean' },
            },
          },
          scheduledAt: { type: 'string', description: 'ISO datetime to schedule for' },
          throttleMs: { type: 'number', description: 'Milliseconds between sends (default 2000)' },
        },
        required: ['name', 'message'],
      },
    },
    execute: async (args, companyId) => {
      const b = await broadcastsService.create(
        companyId,
        {
          name: args.name as string,
          message: args.message as string,
          mediaUrl: args.mediaUrl as string | undefined,
          mediaType: args.mediaType as string | undefined,
          mediaCaption: args.mediaCaption as string | undefined,
          variables: args.variables as Record<string, string> | undefined,
          audience: args.audience as never,
          scheduledAt: args.scheduledAt as string | undefined,
          throttleMs: args.throttleMs as number | undefined,
        },
        AI_BROADCAST_ACTOR,
      );
      return `Created broadcast "${b.name}" (ID: ${b.id}, status: ${b.status}, audience: ${b.totalRecipients})`;
    },
  },
  {
    definition: {
      name: 'update_broadcast',
      description: 'Update arbitrary broadcast fields. Only allowed in DRAFT or SCHEDULED state.',
      parameters: {
        type: 'object',
        properties: {
          broadcastId: { type: 'string' },
          name: { type: 'string' },
          message: { type: 'string' },
          mediaUrl: { type: 'string' },
          variables: { type: 'object' },
          throttleMs: { type: 'number' },
        },
        required: ['broadcastId'],
      },
    },
    execute: async (args, companyId) => {
      const b = await broadcastsService.update(
        companyId,
        args.broadcastId as string,
        {
          name: args.name as string | undefined,
          message: args.message as string | undefined,
          mediaUrl: args.mediaUrl as string | undefined,
          variables: args.variables as Record<string, string> | undefined,
          throttleMs: args.throttleMs as number | undefined,
        },
        AI_BROADCAST_ACTOR,
      );
      return `Updated "${b.name}"`;
    },
  },
  {
    definition: {
      name: 'set_broadcast_audience',
      description: 'Set or replace the audience for a broadcast. Resolves the filter NOW and snapshots recipients into the database. Only allowed in DRAFT.',
      parameters: {
        type: 'object',
        properties: {
          broadcastId: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          contactIds: { type: 'array', items: { type: 'string' } },
          lifecycleStage: { type: 'string' },
          scoreMin: { type: 'number' },
          scoreMax: { type: 'number' },
          hasOpenDeal: { type: 'boolean' },
          hasOpenLead: { type: 'boolean' },
        },
        required: ['broadcastId'],
      },
    },
    execute: async (args, companyId) => {
      const result = await broadcastsService.setAudience(
        companyId,
        args.broadcastId as string,
        {
          tags: args.tags as string[] | undefined,
          contactIds: args.contactIds as string[] | undefined,
          lifecycleStage: args.lifecycleStage as string | undefined,
          scoreMin: args.scoreMin as number | undefined,
          scoreMax: args.scoreMax as number | undefined,
          hasOpenDeal: args.hasOpenDeal as boolean | undefined,
          hasOpenLead: args.hasOpenLead as boolean | undefined,
        },
        AI_BROADCAST_ACTOR,
      );
      return `Audience set — ${result.totalRecipients} recipient${result.totalRecipients === 1 ? '' : 's'} queued`;
    },
  },
  {
    definition: {
      name: 'preview_audience_size',
      description: 'Preview the size of an audience filter WITHOUT creating a broadcast. Use this when the user asks "how many people will get this".',
      parameters: {
        type: 'object',
        properties: {
          tags: { type: 'array', items: { type: 'string' } },
          contactIds: { type: 'array', items: { type: 'string' } },
          lifecycleStage: { type: 'string' },
          scoreMin: { type: 'number' },
          hasOpenDeal: { type: 'boolean' },
          hasOpenLead: { type: 'boolean' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      const result = await broadcastsService.previewAudienceSize(companyId, {
        tags: args.tags as string[] | undefined,
        contactIds: args.contactIds as string[] | undefined,
        lifecycleStage: args.lifecycleStage as string | undefined,
        scoreMin: args.scoreMin as number | undefined,
        hasOpenDeal: args.hasOpenDeal as boolean | undefined,
        hasOpenLead: args.hasOpenLead as boolean | undefined,
      });
      const sample = result.sample.map((c) => c.displayName ?? c.phoneNumber).join(', ');
      return `${result.count} contact${result.count === 1 ? '' : 's'} match${result.count === 1 ? 'es' : ''} this audience.${sample ? `\nFirst few: ${sample}` : ''}`;
    },
  },
  {
    definition: {
      name: 'schedule_broadcast',
      description: 'Schedule a DRAFT broadcast to send at a specific time. Audience must already be set.',
      parameters: {
        type: 'object',
        properties: {
          broadcastId: { type: 'string' },
          scheduledAt: { type: 'string', description: 'ISO datetime' },
        },
        required: ['broadcastId', 'scheduledAt'],
      },
    },
    execute: async (args, companyId) => {
      const b = await broadcastsService.schedule(
        companyId,
        args.broadcastId as string,
        args.scheduledAt as string,
        AI_BROADCAST_ACTOR,
      );
      return `Scheduled "${b.name}" for ${b.scheduledAt?.toISOString().slice(0, 16)}`;
    },
  },
  {
    definition: {
      name: 'unschedule_broadcast',
      description: 'Cancel the schedule of a SCHEDULED broadcast — moves it back to DRAFT.',
      parameters: {
        type: 'object',
        properties: { broadcastId: { type: 'string' } },
        required: ['broadcastId'],
      },
    },
    execute: async (args, companyId) => {
      await broadcastsService.unschedule(companyId, args.broadcastId as string, AI_BROADCAST_ACTOR);
      return 'Unscheduled — back to DRAFT';
    },
  },
  {
    definition: {
      name: 'send_broadcast_now',
      description: 'Send a DRAFT or SCHEDULED broadcast immediately. Audience must already be set.',
      parameters: {
        type: 'object',
        properties: { broadcastId: { type: 'string' } },
        required: ['broadcastId'],
      },
    },
    execute: async (args, companyId) => {
      const b = await broadcastsService.sendNow(companyId, args.broadcastId as string, AI_BROADCAST_ACTOR);
      return `Started sending "${b.name}" — ${b.totalRecipients} recipient${b.totalRecipients === 1 ? '' : 's'}`;
    },
  },
  {
    definition: {
      name: 'pause_broadcast',
      description: 'Pause an in-progress broadcast. Stops sending more messages until you resume.',
      parameters: {
        type: 'object',
        properties: { broadcastId: { type: 'string' } },
        required: ['broadcastId'],
      },
    },
    execute: async (args, companyId) => {
      await broadcastsService.pause(companyId, args.broadcastId as string, AI_BROADCAST_ACTOR);
      return 'Paused';
    },
  },
  {
    definition: {
      name: 'resume_broadcast',
      description: 'Resume a paused broadcast.',
      parameters: {
        type: 'object',
        properties: { broadcastId: { type: 'string' } },
        required: ['broadcastId'],
      },
    },
    execute: async (args, companyId) => {
      await broadcastsService.resume(companyId, args.broadcastId as string, AI_BROADCAST_ACTOR);
      return 'Resumed';
    },
  },
  {
    definition: {
      name: 'cancel_broadcast',
      description: 'Cancel a broadcast. Marks all still-queued recipients as SKIPPED.',
      parameters: {
        type: 'object',
        properties: { broadcastId: { type: 'string' } },
        required: ['broadcastId'],
      },
    },
    execute: async (args, companyId) => {
      await broadcastsService.cancel(companyId, args.broadcastId as string, AI_BROADCAST_ACTOR);
      return 'Cancelled';
    },
  },
  {
    definition: {
      name: 'retry_failed_recipients',
      description: 'Reset all FAILED recipients of a broadcast back to QUEUED and re-send. Useful after fixing a connectivity issue.',
      parameters: {
        type: 'object',
        properties: { broadcastId: { type: 'string' } },
        required: ['broadcastId'],
      },
    },
    execute: async (args, companyId) => {
      await broadcastsService.retryFailed(companyId, args.broadcastId as string, AI_BROADCAST_ACTOR);
      return 'Retrying failed recipients';
    },
  },
  {
    definition: {
      name: 'duplicate_broadcast',
      description: 'Clone a broadcast as a new DRAFT.',
      parameters: {
        type: 'object',
        properties: {
          broadcastId: { type: 'string' },
          newName: { type: 'string' },
        },
        required: ['broadcastId'],
      },
    },
    execute: async (args, companyId) => {
      const b = await broadcastsService.duplicate(
        companyId,
        args.broadcastId as string,
        AI_BROADCAST_ACTOR,
        args.newName as string | undefined,
      );
      return `Duplicated as "${b.name}" (ID: ${b.id})`;
    },
  },
  {
    definition: {
      name: 'delete_broadcast',
      description: 'Permanently delete a broadcast. Cannot delete a broadcast that is currently SENDING.',
      parameters: {
        type: 'object',
        properties: { broadcastId: { type: 'string' } },
        required: ['broadcastId'],
      },
    },
    execute: async (args, companyId) => {
      await broadcastsService.delete(companyId, args.broadcastId as string, AI_BROADCAST_ACTOR);
      return 'Deleted';
    },
  },
  {
    definition: {
      name: 'get_broadcast_recipients',
      description: 'List recipients of a broadcast with their per-recipient delivery status (QUEUED/SENT/DELIVERED/READ/FAILED/SKIPPED).',
      parameters: {
        type: 'object',
        properties: {
          broadcastId: { type: 'string' },
          status: { type: 'string', enum: ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED'] },
          limit: { type: 'number' },
        },
        required: ['broadcastId'],
      },
    },
    execute: async (args, companyId) => {
      const result = await broadcastsService.getRecipients(companyId, args.broadcastId as string, {
        status: args.status as string | undefined,
        limit: (args.limit as number) ?? 20,
      });
      if (!result.items.length) return 'No recipients match.';
      return [
        `${result.total} total (showing ${result.items.length}):`,
        ...result.items.map((r) => {
          const name = r.contact?.displayName ?? r.toPhone;
          const err = r.errorMessage ? ` — ${r.errorMessage.slice(0, 60)}` : '';
          return `- [${r.status}] ${name}${err}`;
        }),
      ].join('\n');
    },
  },
  {
    definition: {
      name: 'get_broadcast_timeline',
      description: 'Fetch the activity timeline of a broadcast.',
      parameters: {
        type: 'object',
        properties: { broadcastId: { type: 'string' }, limit: { type: 'number' } },
        required: ['broadcastId'],
      },
    },
    execute: async (args, companyId) => {
      const items = await broadcastsService.getTimeline(companyId, args.broadcastId as string, (args.limit as number) ?? 20);
      if (!items.length) return 'No activity yet.';
      return items
        .map((a) => `- ${a.createdAt.toISOString().slice(0, 16)} [${a.type}] ${a.title}`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'get_broadcast_stats',
      description: 'Broadcast stats — counts per status, sent/failed/delivered/read totals, delivery rate, open rate.',
      parameters: {
        type: 'object',
        properties: { days: { type: 'number', description: 'Lookback window (default 30)' } },
        required: [],
      },
    },
    execute: async (_args, companyId) => {
      const s = await broadcastsService.stats(companyId, (_args.days as number) ?? 30);
      return [
        `Broadcast stats — last ${s.rangeDays} days`,
        `Sent: ${s.sent} · Failed: ${s.failed} · Delivered: ${s.delivered} · Read: ${s.read}`,
        `Delivery rate: ${s.deliveryRate}% · Open rate: ${s.openRate}%`,
        `By status: ${Object.entries(s.byStatus).map(([k, v]) => `${k}=${v}`).join(', ')}`,
      ].join('\n');
    },
  },

  // ── Analytics ─────────────────────────────────────────────────────────────
  {
    definition: {
      name: 'get_analytics',
      description: 'Get CRM dashboard analytics and KPIs.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    execute: async (_args, companyId) => {
      const [contacts, leads, deals, tasks, conversations, payments] = await Promise.all([
        prisma.contact.count({ where: { companyId, deletedAt: null } }),
        prisma.lead.count({ where: { companyId } }),
        prisma.deal.findMany({ where: { companyId }, select: { stage: true, value: true } }),
        prisma.task.count({ where: { companyId, status: { in: ['TODO', 'IN_PROGRESS'] } } }),
        prisma.conversation.count({ where: { companyId, status: { in: ['OPEN', 'AI_HANDLING'] } } }),
        prisma.payment.findMany({ where: { companyId, status: 'PAID' }, select: { amount: true } }),
      ]);
      const pipelineValue = deals.filter((d) => !['WON', 'LOST'].includes(d.stage)).reduce((s, d) => s + (d.value ?? 0), 0);
      const revenue = payments.reduce((s, p) => s + p.amount, 0);
      const wonDeals = deals.filter((d) => d.stage === 'WON').length;
      return `CRM Analytics:\n- Contacts: ${contacts}\n- Leads: ${leads}\n- Active Deals: ${deals.length - wonDeals} (Pipeline: ₹${pipelineValue})\n- Won Deals: ${wonDeals}\n- Open Tasks: ${tasks}\n- Active Conversations: ${conversations}\n- Revenue: ₹${revenue / 100}`;
    },
  },

  // ── Payments (full lifecycle — 18 tools) ─────────────────────────────────
  {
    definition: {
      name: 'list_payments',
      description: 'List payment records with rich filters. Money is in minor units (paise/cents).',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Comma-separated: PENDING, PAID, FAILED, REFUNDED, EXPIRED' },
          provider: { type: 'string', description: 'Comma-separated: RAZORPAY, STRIPE, CASHFREE, PHONEPE, PAYU, NONE (manual)' },
          contactId: { type: 'string' },
          dealId: { type: 'string' },
          invoiceId: { type: 'string' },
          tag: { type: 'string' },
          search: { type: 'string' },
          sort: { type: 'string', enum: ['recent', 'amount', 'paid_at'] },
          page: { type: 'number' },
          limit: { type: 'number' },
        },
      },
    },
    execute: async (args, companyId) => {
      const filters: ListPaymentsFilters = {
        status: args.status ? (String(args.status).split(',') as never) : undefined,
        provider: args.provider ? (String(args.provider).split(',') as never) : undefined,
        contactId: args.contactId as string | undefined,
        dealId: args.dealId as string | undefined,
        invoiceId: args.invoiceId as string | undefined,
        tag: args.tag as string | undefined,
        search: args.search as string | undefined,
        sort: args.sort as ListPaymentsFilters['sort'],
        page: typeof args.page === 'number' ? args.page : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      };
      const { items, total } = await paymentsService.list(companyId, filters);
      if (items.length === 0) return 'No payments match.';
      return `${items.length}/${total} payments:\n` + items
        .map((p) => `- [${p.status}] ${formatMinor(p.amount, p.currency)} · ${p.provider}${p.method ? `/${p.method}` : ''} · ${p.description ?? '(no desc)'} · ${new Date(p.createdAt).toLocaleDateString()} (id: ${p.id})`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'get_payment',
      description: 'Get full payment details including linked contact/deal/invoice and recent activity.',
      parameters: { type: 'object', properties: { paymentId: { type: 'string' } }, required: ['paymentId'] },
    },
    execute: async (args, companyId) => {
      const p = await paymentsService.get(companyId, args.paymentId as string);
      return JSON.stringify({
        id: p.id,
        status: p.status,
        provider: p.provider,
        method: p.method,
        amount: p.amount,
        amountFormatted: formatMinor(p.amount, p.currency),
        refundedAmount: p.refundedAmount,
        refundedAmountFormatted: formatMinor(p.refundedAmount, p.currency),
        currency: p.currency,
        description: p.description,
        externalId: p.externalId,
        linkUrl: p.linkUrl,
        refundId: p.refundId,
        contactId: p.contactId,
        dealId: p.dealId,
        invoiceId: p.invoiceId,
        paidAt: p.paidAt,
        refundedAt: p.refundedAt,
        recentActivity: p.activities.map((a) => `[${a.createdAt.toISOString()}] ${a.type} — ${a.title}`),
      }, null, 2);
    },
  },
  {
    definition: {
      name: 'create_payment_link',
      description: 'Create a gateway payment link (Razorpay/Stripe/etc) for a contact. Amount is in minor units. Optionally link to an invoice so the payment auto-reconciles.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          amount: { type: 'number', description: 'Minor units (e.g. 50000 = ₹500.00)' },
          description: { type: 'string' },
          currency: { type: 'string', description: 'Defaults to the company config currency' },
          dealId: { type: 'string' },
          invoiceId: { type: 'string', description: 'If set, the invoice auto-marks PAID when this payment is received' },
          notes: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['contactId', 'amount', 'description'],
      },
    },
    execute: async (args, companyId) => {
      const dto: CreatePaymentLinkDto = {
        contactId: args.contactId as string,
        amount: args.amount as number,
        description: args.description as string,
        currency: args.currency as string | undefined,
        dealId: args.dealId as string | undefined,
        invoiceId: args.invoiceId as string | undefined,
        notes: args.notes as string | undefined,
        tags: (args.tags as string[] | undefined) ?? undefined,
      };
      const p = await paymentsService.createLink(companyId, AI_PAYMENT_ACTOR, dto);
      return `Created payment link — ${formatMinor(p.amount, p.currency)} via ${p.provider}. URL: ${p.linkUrl}. Status: ${p.status}. id: ${p.id}`;
    },
  },
  {
    definition: {
      name: 'record_manual_payment',
      description: 'Record a payment that happened outside the gateway (cash, bank transfer, cheque, UPI). Creates a Payment row with provider=NONE and status=PAID immediately. If linked to an invoice, the invoice auto-updates.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Minor units' },
          description: { type: 'string' },
          contactId: { type: 'string' },
          dealId: { type: 'string' },
          invoiceId: { type: 'string' },
          method: { type: 'string', enum: ['cash', 'bank_transfer', 'cheque', 'upi', 'other'] },
          currency: { type: 'string' },
          paidAt: { type: 'string', description: 'ISO date, defaults to now' },
          notes: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['amount', 'description'],
      },
    },
    execute: async (args, companyId) => {
      const dto: RecordManualPaymentDto = {
        amount: args.amount as number,
        description: args.description as string,
        contactId: args.contactId as string | undefined,
        dealId: args.dealId as string | undefined,
        invoiceId: args.invoiceId as string | undefined,
        method: args.method as string | undefined,
        currency: args.currency as string | undefined,
        paidAt: args.paidAt as string | undefined,
        notes: args.notes as string | undefined,
        tags: (args.tags as string[] | undefined) ?? undefined,
      };
      const p = await paymentsService.recordManualPayment(companyId, AI_PAYMENT_ACTOR, dto);
      return `Recorded manual payment — ${formatMinor(p.amount, p.currency)} (${dto.method ?? 'other'}). Status: PAID. id: ${p.id}`;
    },
  },
  {
    definition: {
      name: 'update_payment',
      description: 'Update payment metadata (description, notes, tags, linked invoice/deal).',
      parameters: {
        type: 'object',
        properties: {
          paymentId: { type: 'string' },
          description: { type: 'string' },
          notes: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          invoiceId: { type: 'string' },
          dealId: { type: 'string' },
        },
        required: ['paymentId'],
      },
    },
    execute: async (args, companyId) => {
      const { paymentId, ...rest } = args;
      await paymentsService.update(
        companyId,
        paymentId as string,
        AI_PAYMENT_ACTOR,
        rest as UpdatePaymentDto,
      );
      return `Updated payment`;
    },
  },
  {
    definition: {
      name: 'refund_payment',
      description: 'Refund a PAID payment. Defaults to a full refund if no amount is given. Razorpay + Stripe call the gateway API; other providers require refunding through the provider dashboard.',
      parameters: {
        type: 'object',
        properties: {
          paymentId: { type: 'string' },
          amount: { type: 'number', description: 'Optional — defaults to full refund. Minor units.' },
          reason: { type: 'string' },
        },
        required: ['paymentId'],
      },
    },
    execute: async (args, companyId) => {
      const dto: RefundPaymentDto = {
        amount: typeof args.amount === 'number' ? args.amount : undefined,
        reason: args.reason as string | undefined,
      };
      const p = await paymentsService.refund(
        companyId,
        args.paymentId as string,
        AI_PAYMENT_ACTOR,
        dto,
      );
      return `Refunded ${formatMinor(p.refundedAmount, p.currency)}. Status: ${p.status}.`;
    },
  },
  {
    definition: {
      name: 'cancel_payment',
      description: 'Cancel a PENDING payment link (marks it EXPIRED). Cannot cancel PAID or REFUNDED — use refund_payment instead.',
      parameters: {
        type: 'object',
        properties: {
          paymentId: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['paymentId'],
      },
    },
    execute: async (args, companyId) => {
      const p = await paymentsService.cancel(
        companyId,
        args.paymentId as string,
        AI_PAYMENT_ACTOR,
        args.reason as string | undefined,
      );
      return `Cancelled payment. Status: ${p.status}.`;
    },
  },
  {
    definition: {
      name: 'link_payment_to_invoice',
      description: 'Link or relink a payment to an invoice. When the payment is PAID, the invoice auto-updates its amountPaid. Useful for manual payments recorded before the invoice existed.',
      parameters: {
        type: 'object',
        properties: {
          paymentId: { type: 'string' },
          invoiceId: { type: 'string' },
        },
        required: ['paymentId', 'invoiceId'],
      },
    },
    execute: async (args, companyId) => {
      await paymentsService.update(
        companyId,
        args.paymentId as string,
        AI_PAYMENT_ACTOR,
        { invoiceId: args.invoiceId as string },
      );
      return `Linked payment to invoice`;
    },
  },
  {
    definition: {
      name: 'link_payment_to_deal',
      description: 'Link or relink a payment to a deal. When the payment is PAID, the deal can auto-move to WON (depending on company config).',
      parameters: {
        type: 'object',
        properties: {
          paymentId: { type: 'string' },
          dealId: { type: 'string' },
        },
        required: ['paymentId', 'dealId'],
      },
    },
    execute: async (args, companyId) => {
      await paymentsService.update(
        companyId,
        args.paymentId as string,
        AI_PAYMENT_ACTOR,
        { dealId: args.dealId as string },
      );
      return `Linked payment to deal`;
    },
  },
  {
    definition: {
      name: 'add_payment_note',
      description: 'Drop a note on the payment timeline.',
      parameters: {
        type: 'object',
        properties: { paymentId: { type: 'string' }, body: { type: 'string' } },
        required: ['paymentId', 'body'],
      },
    },
    execute: async (args, companyId) => {
      await paymentsService.addNote(
        companyId,
        args.paymentId as string,
        AI_PAYMENT_ACTOR,
        args.body as string,
      );
      return `Note added`;
    },
  },
  {
    definition: {
      name: 'delete_payment',
      description: 'Permanently delete a payment. Cannot delete PAID or REFUNDED payments — they are part of the financial record.',
      parameters: { type: 'object', properties: { paymentId: { type: 'string' } }, required: ['paymentId'] },
    },
    execute: async (args, companyId) => {
      await paymentsService.remove(companyId, args.paymentId as string);
      return `Deleted`;
    },
  },
  {
    definition: {
      name: 'get_payment_stats',
      description: 'Aggregate payment stats for the last N days — received, pending, refunded, success rate, by status, by provider.',
      parameters: {
        type: 'object',
        properties: { days: { type: 'number', description: 'Lookback window. Default 30.' } },
      },
    },
    execute: async (args, companyId) => {
      const s = await paymentsService.stats(
        companyId,
        typeof args.days === 'number' ? args.days : 30,
      );
      return `Payments (${s.rangeDays}d): ${s.totalPayments} total\n` +
        `Received: ${formatMinor(s.totalReceived)} · Pending: ${formatMinor(s.totalPending)} · Refunded: ${formatMinor(s.totalRefunded)}\n` +
        `Success rate: ${s.successRate ?? 'n/a'}% · Average: ${s.averageAmount !== null ? formatMinor(s.averageAmount) : 'n/a'}\n` +
        `By status: ${Object.entries(s.byStatus).map(([k, v]) => `${k}=${v}`).join(' · ') || '(none)'}\n` +
        `By provider: ${Object.entries(s.byProvider).map(([k, v]) => `${k}=${v}`).join(' · ') || '(none)'}`;
    },
  },
  {
    definition: {
      name: 'get_payment_timeline',
      description: 'Fetch the activity timeline for a payment (most recent first).',
      parameters: {
        type: 'object',
        properties: {
          paymentId: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['paymentId'],
      },
    },
    execute: async (args, companyId) => {
      const events = await paymentsService.getTimeline(
        companyId,
        args.paymentId as string,
        typeof args.limit === 'number' ? args.limit : 30,
      );
      if (events.length === 0) return 'No activity.';
      return events
        .map((e) => `[${e.createdAt.toISOString()}] ${e.type} (${e.actorType}) — ${e.title}${e.body ? '\n  ' + e.body : ''}`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'get_payment_link_url',
      description: 'Get the gateway-hosted payment URL for a payment. Useful for sharing via WhatsApp/email.',
      parameters: { type: 'object', properties: { paymentId: { type: 'string' } }, required: ['paymentId'] },
    },
    execute: async (args, companyId) => {
      const p = await paymentsService.get(companyId, args.paymentId as string);
      if (!p.linkUrl) {
        return `MEMORY_SEARCH_UNAVAILABLE: no gateway URL — this is a ${p.provider === 'NONE' ? 'manual (provider=NONE)' : 'pending'} payment without a hosted link`;
      }
      return p.linkUrl;
    },
  },
  {
    definition: {
      name: 'list_payments_for_invoice',
      description: 'List all payments linked to a specific invoice. Useful for seeing partial-payment history.',
      parameters: {
        type: 'object',
        properties: { invoiceId: { type: 'string' } },
        required: ['invoiceId'],
      },
    },
    execute: async (args, companyId) => {
      const { items, total } = await paymentsService.list(companyId, {
        invoiceId: args.invoiceId as string,
        limit: 50,
      });
      if (items.length === 0) return 'No payments linked to this invoice.';
      return `${items.length}/${total} payments:\n` + items
        .map((p) => `- [${p.status}] ${formatMinor(p.amount, p.currency)} · ${p.provider}${p.method ? `/${p.method}` : ''} · ${p.paidAt ? 'paid ' + new Date(p.paidAt).toLocaleDateString() : 'pending'} (id: ${p.id})`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'list_payments_for_contact',
      description: 'List all payments received from a contact across all invoices and deals.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          status: { type: 'string', description: 'Optional status filter' },
        },
        required: ['contactId'],
      },
    },
    execute: async (args, companyId) => {
      const { items, total } = await paymentsService.list(companyId, {
        contactId: args.contactId as string,
        status: args.status ? (String(args.status).split(',') as never) : undefined,
        limit: 50,
      });
      if (items.length === 0) return 'No payments from this contact.';
      return `${items.length}/${total} payments:\n` + items
        .map((p) => `- [${p.status}] ${formatMinor(p.amount, p.currency)} · ${p.description ?? ''} · ${new Date(p.createdAt).toLocaleDateString()}`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'bulk_cancel_payments',
      description: 'Cancel multiple PENDING payments at once.',
      parameters: {
        type: 'object',
        properties: {
          paymentIds: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
        required: ['paymentIds'],
      },
    },
    execute: async (args, companyId) => {
      const r = await paymentsService.bulkCancel(
        companyId,
        args.paymentIds as string[],
        AI_PAYMENT_ACTOR,
        args.reason as string | undefined,
      );
      return `Cancelled ${r.updated}, failed ${r.failed}.`;
    },
  },

  // ── Phase 1: Contact Management Tools ─────────────────────────────────────
  {
    definition: {
      name: 'add_contact_note',
      description: 'Add a timestamped note to a contact.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          phoneNumber: { type: 'string', description: 'Lookup by phone if no contactId' },
          content: { type: 'string', description: 'Note text' },
        },
        required: ['content'],
      },
    },
    execute: async (args, companyId) => {
      let contactId = args.contactId as string;
      if (!contactId && args.phoneNumber) {
        const c = await prisma.contact.findFirst({ where: { companyId, phoneNumber: args.phoneNumber as string } });
        if (!c) return 'Contact not found';
        contactId = c.id;
      }
      if (!contactId) return 'Please provide contactId or phoneNumber';
      await prisma.contactNote.create({ data: { companyId, contactId, content: args.content as string } });
      return `Note added to contact`;
    },
  },
  {
    definition: {
      name: 'get_contact_timeline',
      description: 'Get the activity timeline for a contact (messages, leads, deals, tasks, payments, notes).',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          phoneNumber: { type: 'string' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      let contactId = args.contactId as string;
      if (!contactId && args.phoneNumber) {
        const c = await prisma.contact.findFirst({ where: { companyId, phoneNumber: args.phoneNumber as string } });
        if (!c) return 'Contact not found';
        contactId = c.id;
      }
      if (!contactId) return 'Please provide contactId or phoneNumber';

      const [messages, leads, deals, tasks, notes] = await Promise.all([
        prisma.message.findMany({ where: { companyId, conversation: { contactId } }, select: { direction: true, body: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 10 }),
        prisma.lead.findMany({ where: { companyId, contactId }, select: { title: true, status: true, createdAt: true } }),
        prisma.deal.findMany({ where: { companyId, contactId }, select: { title: true, stage: true, value: true, createdAt: true } }),
        prisma.task.findMany({ where: { companyId, contactId }, select: { title: true, status: true, dueAt: true, createdAt: true } }),
        prisma.contactNote.findMany({ where: { contactId }, select: { content: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5 }),
      ]);

      const lines: string[] = [];
      if (messages.length) lines.push(`Messages (${messages.length}):\n${messages.map((m) => `  ${m.direction}: ${(m.body ?? '').slice(0, 50)}`).join('\n')}`);
      if (leads.length) lines.push(`Leads: ${leads.map((l) => `${l.title} [${l.status}]`).join(', ')}`);
      if (deals.length) lines.push(`Deals: ${deals.map((d) => `${d.title} [${d.stage}] ₹${d.value}`).join(', ')}`);
      if (tasks.length) lines.push(`Tasks: ${tasks.map((t) => `${t.title} [${t.status}]`).join(', ')}`);
      if (notes.length) lines.push(`Notes:\n${notes.map((n) => `  - ${n.content.slice(0, 80)}`).join('\n')}`);
      return lines.join('\n\n') || 'No activity found';
    },
  },
  {
    definition: {
      name: 'tag_contact',
      description: 'Add or remove tags from a contact.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          phoneNumber: { type: 'string' },
          addTags: { type: 'array', items: { type: 'string' }, description: 'Tags to add' },
          removeTags: { type: 'array', items: { type: 'string' }, description: 'Tags to remove' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      let contactId = args.contactId as string;
      if (!contactId && args.phoneNumber) {
        const c = await prisma.contact.findFirst({ where: { companyId, phoneNumber: args.phoneNumber as string } });
        if (!c) return 'Contact not found';
        contactId = c.id;
      }
      if (!contactId) return 'Please provide contactId or phoneNumber';

      const contact = await prisma.contact.findUnique({ where: { id: contactId } });
      if (!contact) return 'Contact not found';

      let tags = [...contact.tags];
      if (args.addTags) tags = [...new Set([...tags, ...(args.addTags as string[])])];
      if (args.removeTags) tags = tags.filter((t) => !(args.removeTags as string[]).includes(t));

      await prisma.contact.update({ where: { id: contactId }, data: { tags } });
      return `Tags updated: [${tags.join(', ')}]`;
    },
  },
  {
    definition: {
      name: 'merge_contacts',
      description: 'Merge two contacts. Keeps the first contact and merges data from the second.',
      parameters: {
        type: 'object',
        properties: {
          keepId: { type: 'string', description: 'Contact ID to keep' },
          mergeId: { type: 'string', description: 'Contact ID to merge into the first' },
        },
        required: ['keepId', 'mergeId'],
      },
    },
    execute: async (args, companyId) => {
      const keep = await prisma.contact.findFirst({ where: { id: args.keepId as string, companyId } });
      const merge = await prisma.contact.findFirst({ where: { id: args.mergeId as string, companyId } });
      if (!keep || !merge) return 'One or both contacts not found';

      const mergedTags = [...new Set([...keep.tags, ...merge.tags])];
      await prisma.contact.update({
        where: { id: keep.id },
        data: {
          tags: mergedTags,
          displayName: keep.displayName || merge.displayName,
          email: keep.email || merge.email,
          score: Math.max(keep.score, merge.score),
        },
      });
      await Promise.all([
        prisma.conversation.updateMany({ where: { contactId: merge.id }, data: { contactId: keep.id } }),
        prisma.lead.updateMany({ where: { contactId: merge.id }, data: { contactId: keep.id } }),
        prisma.deal.updateMany({ where: { contactId: merge.id }, data: { contactId: keep.id } }),
        prisma.task.updateMany({ where: { contactId: merge.id }, data: { contactId: keep.id } }),
      ]);
      await prisma.contact.update({ where: { id: merge.id }, data: { deletedAt: new Date() } });
      return `Merged contact ${merge.displayName || merge.phoneNumber} into ${keep.displayName || keep.phoneNumber}`;
    },
  },
  {
    definition: {
      name: 'import_contacts',
      description: 'Import contacts from CSV data. Each row needs at least a phone number.',
      parameters: {
        type: 'object',
        properties: {
          csv: { type: 'string', description: 'CSV text with header row. Must include "phone" column. Optional: "name", "email", "tags" columns.' },
        },
        required: ['csv'],
      },
    },
    execute: async (args, companyId) => {
      const csv = args.csv as string;
      const lines = csv.trim().split('\n');
      if (lines.length < 2) return 'CSV needs a header and at least one row';

      const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
      const phoneIdx = header.findIndex((h) => h.includes('phone'));
      const nameIdx = header.findIndex((h) => h.includes('name'));
      const emailIdx = header.findIndex((h) => h.includes('email'));

      if (phoneIdx === -1) return 'CSV must have a "phone" column';

      let imported = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
        const phone = cols[phoneIdx];
        if (!phone) continue;
        try {
          await prisma.contact.upsert({
            where: { companyId_phoneNumber: { companyId, phoneNumber: phone } },
            create: { companyId, phoneNumber: phone, displayName: nameIdx >= 0 ? cols[nameIdx] : undefined, email: emailIdx >= 0 ? cols[emailIdx] : undefined },
            update: {},
          });
          imported++;
        } catch { /* skip errors */ }
      }
      return `Imported ${imported} of ${lines.length - 1} contacts`;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2-11: Extended AI Tools
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Templates ─────────────────────────────────────────────────────────────
  {
    definition: {
      name: 'list_templates',
      description: 'List message templates with rich filters. Shows name, category, status, type, and usage stats.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status: DRAFT, ACTIVE, or ARCHIVED' },
          category: { type: 'string', description: 'Filter by category (greeting, follow_up, promotion, payment_reminder, etc.)' },
          type: { type: 'string', description: 'Filter by type: TEXT, IMAGE, DOCUMENT, VIDEO' },
          search: { type: 'string', description: 'Search in name and body' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      const result = await templatesService.list(companyId, {
        status: args.status as any,
        category: args.category as any,
        type: args.type as any,
        search: args.search as string,
        limit: args.limit as number | undefined,
      });
      if (result.items.length === 0) return 'No templates found';
      return result.items
        .map((t: any) => `- "${t.name}" [${t.category}/${t.status}]: ${t.body.slice(0, 50)}... (used ${t.useCount}x)`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'get_template',
      description: 'Get detailed template information including variables, tags, media, and usage stats.',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', description: 'Template ID' },
          templateName: { type: 'string', description: 'Template name (alternative to ID)' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      let templateId = args.templateId as string | undefined;
      if (args.templateName && !templateId) {
        const template = await prisma.template.findFirst({
          where: { companyId, name: args.templateName as string },
          select: { id: true },
        });
        if (!template) return `Template "${args.templateName}" not found`;
        templateId = template.id;
      }
      if (!templateId) return 'Either templateId or templateName is required';
      const template = await templatesService.get(companyId, templateId as string);
      const vars = Object.keys((template.variables as Record<string, string>) || {});
      return `Template: ${template.name}\nCategory: ${template.category}\nStatus: ${template.status}\nType: ${template.type}\nBody: ${template.body}\nVariables: ${vars.length ? vars.join(', ') : 'none'}\nTags: ${(template.tags as string[]).join(', ') || 'none'}\nUsed ${template.useCount} times, sent ${template.sentCount}x`;
    },
  },
  {
    definition: {
      name: 'create_template',
      description: 'Create a new message template. Templates use {{variable}} syntax for personalization. Always starts as DRAFT.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Unique template name' },
          body: { type: 'string', description: 'Template body with {{variable}} placeholders' },
          category: { type: 'string', description: 'Category: greeting, follow_up, promotion, payment_reminder, order_update, support, feedback, review, appointment, general' },
          type: { type: 'string', description: 'Type: TEXT, IMAGE, DOCUMENT, VIDEO (default TEXT)' },
          variables: { type: 'object', description: 'Default values for variables (e.g., {firstName: "John"})' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for organization' },
          language: { type: 'string', description: 'ISO 639-1 language code (default en)' },
        },
        required: ['name', 'body'],
      },
    },
    execute: async (args, companyId) => {
      const template = await templatesService.create(companyId, {
        name: args.name as string,
        body: args.body as string,
        category: args.category as any,
        type: args.type as any,
        variables: args.variables as Record<string, string> | undefined,
        tags: args.tags as string[] | undefined,
        language: args.language as string | undefined,
      }, AI_TEMPLATE_ACTOR);
      const vars = ((args.body as string).match(/\{\{(\w+)\}\}/g) || []).map((v) => v.slice(2, -2));
      return `Created DRAFT template "${template.name}" with ${vars.length} variables: ${vars.join(', ') || 'none'}. Use activate_template to make it active.`;
    },
  },
  {
    definition: {
      name: 'update_template',
      description: 'Update an existing template. Only DRAFT and ARCHIVED templates can be edited.',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', description: 'Template ID' },
          name: { type: 'string', description: 'New name' },
          body: { type: 'string', description: 'New body' },
          category: { type: 'string', description: 'New category' },
          tags: { type: 'array', items: { type: 'string' }, description: 'New tags' },
          variables: { type: 'object', description: 'New variable defaults' },
        },
        required: ['templateId'],
      },
    },
    execute: async (args, companyId) => {
      const template = await templatesService.update(companyId, args.templateId as string, {
        name: args.name as string | undefined,
        body: args.body as string | undefined,
        category: args.category as any,
        tags: args.tags as string[] | undefined,
        variables: args.variables as Record<string, string> | undefined,
      }, AI_TEMPLATE_ACTOR);
      return `Updated template "${template.name}". Status: ${template.status}`;
    },
  },
  {
    definition: {
      name: 'activate_template',
      description: 'Activate a DRAFT template for use. Auto-extracts variables from body.',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', description: 'Template ID to activate' },
        },
        required: ['templateId'],
      },
    },
    execute: async (args, companyId) => {
      const template = await templatesService.activate(companyId, args.templateId as string, AI_TEMPLATE_ACTOR);
      const vars = Object.keys((template.variables as Record<string, string>) || {});
      return `Activated template "${template.name}" with variables: ${vars.join(', ') || 'none'}`;
    },
  },
  {
    definition: {
      name: 'archive_template',
      description: 'Archive a template (removes from active list but keeps history).',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', description: 'Template ID to archive' },
        },
        required: ['templateId'],
      },
    },
    execute: async (args, companyId) => {
      const template = await templatesService.archive(companyId, args.templateId as string, AI_TEMPLATE_ACTOR);
      return `Archived template "${template.name}"`;
    },
  },
  {
    definition: {
      name: 'duplicate_template',
      description: 'Duplicate a template as a new DRAFT. Useful for A/B testing variations.',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', description: 'Template ID to duplicate' },
          newName: { type: 'string', description: 'Name for the duplicate (default: "name (copy)")' },
        },
        required: ['templateId'],
      },
    },
    execute: async (args, companyId) => {
      const template = await templatesService.duplicate(companyId, args.templateId as string, AI_TEMPLATE_ACTOR, args.newName as string | undefined);
      return `Created duplicate "${template.name}" from template`;
    },
  },
  {
    definition: {
      name: 'delete_template',
      description: 'Permanently delete a DRAFT or ARCHIVED template. Active templates must be archived first.',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', description: 'Template ID to delete' },
        },
        required: ['templateId'],
      },
    },
    execute: async (args, companyId) => {
      await templatesService.delete(companyId, args.templateId as string, AI_TEMPLATE_ACTOR);
      return `Deleted template`;
    },
  },
  {
    definition: {
      name: 'preview_template',
      description: 'Preview a template with variable substitution without sending.',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', description: 'Template ID' },
          variables: { type: 'object', description: 'Variable values for substitution (e.g., {firstName: "John"})' },
        },
        required: ['templateId'],
      },
    },
    execute: async (args, companyId) => {
      const result = await templatesService.render(companyId, args.templateId as string, (args.variables as Record<string, string> | undefined) ?? {});
      return `Preview:\n${result.rendered}`;
    },
  },
  {
    definition: {
      name: 'get_template_stats',
      description: 'Get template usage statistics including total counts, top performers, and breakdowns.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Number of days to look back (default 30)' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      const stats = await templatesService.stats(companyId, args.days as number | undefined);
      return `Templates: ${stats.totalTemplates} total (${stats.activeTemplates} active, ${stats.draftTemplates} draft, ${stats.archivedTemplates} archived)\nTotal uses: ${stats.totalUses}\nTop templates: ${stats.topTemplates.map((t: any) => `"${t.name}" (${t.conversionRate}% convert, ${t.useCount} uses)`).join(', ')}\nBy category: ${Object.entries(stats.byCategory).map(([k, v]) => `${k}: ${v}`).join(', ')}`;
    },
  },
  {
    definition: {
      name: 'send_template',
      description: 'Send a template message via WhatsApp with variable substitution. Template must be ACTIVE.',
      parameters: {
        type: 'object',
        properties: {
          templateName: { type: 'string', description: 'Template name' },
          phoneNumber: { type: 'string', description: 'Phone number with country code' },
          variables: { type: 'object', description: 'Variable values for substitution' },
        },
        required: ['templateName', 'phoneNumber'],
      },
    },
    execute: async (args, companyId) => {
      const template = await prisma.template.findFirst({ where: { companyId, name: args.templateName as string } });
      if (!template) return `Template "${args.templateName}" not found`;
      if (template.status !== 'ACTIVE') return `Template "${template.name}" is ${template.status}. Activate it first.`;

      // Render with variables
      let text = template.body;
      const vars = (args.variables || {}) as Record<string, string>;
      const allVars = { ...((template.variables as Record<string, string>) || {}), ...vars };
      for (const [k, v] of Object.entries(allVars)) {
        text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v || '');
      }

      // Find connected WhatsApp account
      const account = await prisma.whatsAppAccount.findFirst({ where: { companyId, status: 'CONNECTED' } });
      if (!account) return 'No connected WhatsApp account found. Connect a WhatsApp account first.';

      // Send via WhatsApp gateway
      await redis.publish('wa:outbound', JSON.stringify({ accountId: account.id, toPhone: args.phoneNumber as string, text }));

      // Record usage
      await templatesService.recordUsage(companyId, template.id);
      await templatesService.recordSent(companyId, template.id);

      return `Sent template "${template.name}" to ${args.phoneNumber}. Body: ${text.slice(0, 100)}${text.length > 100 ? '...' : ''}`;
    },
  },

  // ── Sequences ─────────────────────────────────────────────────────────────
  // Sequence Management Tools (12 tools)
  {
    definition: {
      name: 'list_sequences',
      description: 'List sequences with filters. Supports filtering by status (DRAFT, ACTIVE, PAUSED, ARCHIVED), search text, tags, and sorting (recent, used, name, completion).',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'], description: 'Filter by sequence status' },
          search: { type: 'string', description: 'Search in name and description' },
          tags: { type: 'string', description: 'Comma-separated tag list to filter' },
          sort: { type: 'string', enum: ['recent', 'used', 'name', 'completion'], description: 'Sort order' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
      },
    },
    execute: async (args, companyId) => {
      const result = await sequencesService.list(companyId, {
        status: args.status as any,
        search: args.search as string,
        tags: args.tags ? (args.tags as string).split(',') : undefined,
        sort: args.sort as any,
        limit: args.limit as number | undefined,
      });
      if (!result.items.length) return 'No sequences found.';
      return [
        `Found ${result.total} sequence(s) (showing ${result.items.length}):`,
        ...result.items.map((s) => {
          const status = s.status.padEnd(8);
          const enroll = s.useCount > 0 ? ` · ${s.useCount} enrollments, ${s.completionCount} completed (${Math.round((s.completionCount / s.useCount) * 100)}%)` : '';
          const tags = s.tags.length ? ` · tags: ${s.tags.join(', ')}` : '';
          return `- [${status}] ${s.name} (${s.steps.length} steps)${enroll}${tags} · ID: ${s.id}`;
        }),
      ].join('\n');
    },
  },
  {
    definition: {
      name: 'get_sequence',
      description: 'Get a sequence with all steps and details.',
      parameters: {
        type: 'object',
        properties: {
          sequenceId: { type: 'string', description: 'Sequence ID' },
        },
        required: ['sequenceId'],
      },
    },
    execute: async (args, companyId) => {
      const s = await sequencesService.get(companyId, args.sequenceId as string);
      const steps = s.steps.map((step: any, i: number) => {
        const delay = `+${step.delayHours}h`;
        const action = step.action.padEnd(15);
        const msg = step.message ? `"${step.message.slice(0, 60)}..."` : step.templateId ? `(template: ${step.templateId})` : '';
        return `  ${i + 1}. [${delay}] ${action} ${msg}`;
      }).join('\n');
      return [
        `Sequence: ${s.name}`,
        `Status: ${s.status}`,
        `Description: ${s.description || 'No description'}`,
        `Tags: ${s.tags.join(', ') || 'None'}`,
        `Stats: ${s.useCount} enrollments, ${s.completionCount} completed`,
        '',
        'Steps:',
        steps || '  (no steps)',
      ].join('\n');
    },
  },
  {
    definition: {
      name: 'get_sequence_timeline',
      description: 'Get activity timeline for a sequence. Shows creation, updates, activations, and other events.',
      parameters: {
        type: 'object',
        properties: {
          sequenceId: { type: 'string' },
          limit: { type: 'number', description: 'Max activities (default 20)' },
        },
        required: ['sequenceId'],
      },
    },
    execute: async (args, companyId) => {
      const activities = await sequencesService.getTimeline(companyId, args.sequenceId as string, args.limit as number | undefined);
      if (!activities.length) return 'No activity recorded for this sequence.';
      return activities.map((a) => {
        const date = new Date(a.createdAt).toLocaleDateString();
        return `${date} · ${a.type} · ${a.title}${a.body ? `\n  ${a.body}` : ''}`;
      }).join('\n');
    },
  },
  {
    definition: {
      name: 'create_sequence',
      description: 'Create a new DRAFT sequence. Optionally include initial steps.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Sequence name (unique per company)' },
          description: { type: 'string', description: 'What this sequence does' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for organization' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sortOrder: { type: 'number' },
                delayHours: { type: 'number', description: 'Hours after previous step' },
                action: {
                  type: 'string',
                  enum: ['send_message', 'send_email', 'wait', 'add_tag', 'remove_tag', 'webhook', 'ai_task'],
                  description: 'Action type',
                },
                message: { type: 'string', description: 'Message text (for send_message)' },
                templateId: { type: 'string', description: 'Template ID instead of message' },
                tagName: { type: 'string', description: 'Tag name (for add_tag/remove_tag)' },
                webhookUrl: { type: 'string', description: 'Webhook URL (for webhook action)' },
              },
            },
            description: 'Initial steps (optional)',
          },
        },
        required: ['name'],
      },
    },
    execute: async (args, companyId) => {
      const steps = (args.steps as Array<any>) || [];
      const sequence = await sequencesService.create(
        companyId,
        {
          name: args.name as string,
          description: args.description as string | undefined,
          tags: args.tags as string[] | undefined,
        },
        { type: 'ai' },
      );
      for (const step of steps) {
        await sequencesService.addStep(companyId, sequence.id, step, { type: 'ai' });
      }
      return `Created DRAFT sequence "${sequence.name}" (ID: ${sequence.id}) with ${steps.length} step(s). Use activate_sequence to make it live.`;
    },
  },
  {
    definition: {
      name: 'update_sequence',
      description: 'Update sequence name, description, or tags. Cannot modify steps directly (use add/update/remove_step).',
      parameters: {
        type: 'object',
        properties: {
          sequenceId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['sequenceId'],
      },
    },
    execute: async (args, companyId) => {
      const sequence = await sequencesService.update(
        companyId,
        args.sequenceId as string,
        {
          name: args.name as string | undefined,
          description: args.description as string | undefined,
          tags: args.tags as string[] | undefined,
        },
        { type: 'ai' },
      );
      return `Updated sequence "${sequence.name}".`;
    },
  },
  {
    definition: {
      name: 'activate_sequence',
      description: 'Activate a DRAFT sequence so it can accept enrollments and start processing.',
      parameters: {
        type: 'object',
        properties: {
          sequenceId: { type: 'string', description: 'Sequence ID to activate' },
        },
        required: ['sequenceId'],
      },
    },
    execute: async (args, companyId) => {
      const sequence = await sequencesService.activate(companyId, args.sequenceId as string, { type: 'ai' });
      return `Activated sequence "${sequence.name}". It is now live and can accept enrollments.`;
    },
  },
  {
    definition: {
      name: 'pause_sequence',
      description: 'Pause an ACTIVE sequence. Existing enrollments will pause; no new enrollments allowed.',
      parameters: {
        type: 'object',
        properties: {
          sequenceId: { type: 'string' },
        },
        required: ['sequenceId'],
      },
    },
    execute: async (args, companyId) => {
      const sequence = await sequencesService.pause(companyId, args.sequenceId as string, { type: 'ai' });
      return `Paused sequence "${sequence.name}". Existing enrollments are paused.`;
    },
  },
  {
    definition: {
      name: 'archive_sequence',
      description: 'Archive a sequence. Removes from active list but preserves data.',
      parameters: {
        type: 'object',
        properties: {
          sequenceId: { type: 'string' },
        },
        required: ['sequenceId'],
      },
    },
    execute: async (args, companyId) => {
      const sequence = await sequencesService.archive(companyId, args.sequenceId as string, { type: 'ai' });
      return `Archived sequence "${sequence.name}".`;
    },
  },
  {
    definition: {
      name: 'duplicate_sequence',
      description: 'Duplicate a sequence as a new DRAFT. Useful for creating variations.',
      parameters: {
        type: 'object',
        properties: {
          sequenceId: { type: 'string', description: 'Source sequence to copy' },
          newName: { type: 'string', description: 'Name for the copy (defaults to "Copy of X")' },
        },
        required: ['sequenceId'],
      },
    },
    execute: async (args, companyId) => {
      const sequence = await sequencesService.duplicate(
        companyId,
        args.sequenceId as string,
        { type: 'ai' },
        args.newName as string | undefined,
      );
      return `Duplicated sequence as "${sequence.name}" (ID: ${sequence.id}). It is in DRAFT status.`;
    },
  },
  {
    definition: {
      name: 'delete_sequence',
      description: 'Delete a sequence permanently. Only works for DRAFT or ARCHIVED sequences.',
      parameters: {
        type: 'object',
        properties: {
          sequenceId: { type: 'string' },
        },
        required: ['sequenceId'],
      },
    },
    execute: async (args, companyId) => {
      await sequencesService.delete(companyId, args.sequenceId as string, { type: 'ai' });
      return 'Sequence deleted.';
    },
  },
  {
    definition: {
      name: 'get_sequence_stats',
      description: 'Get overall sequence statistics for the company.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    execute: async (args, companyId) => {
      const stats = await sequencesService.getStats(companyId);
      return [
        'Sequence Statistics:',
        `- Total sequences: ${stats.totalSequences}`,
        `- Active sequences: ${stats.activeSequences}`,
        `- Total enrollments: ${stats.totalEnrollments}`,
        `- Active enrollments: ${stats.activeEnrollments}`,
        `- Overall completion rate: ${Math.round(stats.overallCompletionRate * 100)}%`,
        '',
        'Top sequences:',
        ...stats.topSequences.map((s) => {
          return `  ${s.name}: ${s.useCount} enrollments, ${s.completionCount} completed (${Math.round(s.rate * 100)}%)`;
        }),
      ].join('\n');
    },
  },
  {
    definition: {
      name: 'get_sequence_performance',
      description: 'Get detailed performance metrics for a sequence. Includes drop-off analysis per step.',
      parameters: {
        type: 'object',
        properties: {
          sequenceId: { type: 'string', description: 'Sequence ID to analyze' },
        },
        required: ['sequenceId'],
      },
    },
    execute: async (args, companyId) => {
      const perf = await sequencesService.getPerformance(companyId, args.sequenceId as string);
      const dropOff = perf.dropOffPerStep.map((d) => {
        return `Step ${d.stepNumber}: ${d.completed}/${d.enrolled} completed (${Math.round(d.dropOffRate * 100)}% drop-off)`;
      }).join('\n  ');
      const avgTime = perf.avgCompletionHours !== null ? `${Math.round(perf.avgCompletionHours)}h` : 'N/A';
      return [
        `Performance for sequence: ${perf.sequenceId}`,
        `- Total enrollments: ${perf.totalEnrollments}`,
        `- Completed: ${perf.completed}`,
        `- Stopped: ${perf.stopped}`,
        `- In progress: ${perf.inProgress}`,
        `- Completion rate: ${Math.round(perf.completionRate * 100)}%`,
        `- Avg time to complete: ${avgTime}`,
        '',
        'Drop-off per step:',
        dropOff || '  (no data)',
      ].join('\n');
    },
  },

  // Step Management Tools (4 tools)
  {
    definition: {
      name: 'add_sequence_step',
      description: 'Add a step to a sequence. Steps execute in order based on sortOrder.',
      parameters: {
        type: 'object',
        properties: {
          sequenceId: { type: 'string' },
          sortOrder: { type: 'number', description: 'Position in sequence (0, 1, 2, ...)' },
          delayHours: { type: 'number', description: 'Hours to wait after previous step completes' },
          action: {
            type: 'string',
            enum: ['send_message', 'send_email', 'wait', 'add_tag', 'remove_tag', 'webhook', 'ai_task'],
            description: 'Action to execute',
          },
          message: { type: 'string', description: 'Message text (for send_message)' },
          templateId: { type: 'string', description: 'Use template instead of message' },
          tagName: { type: 'string', description: 'Tag name (for add_tag/remove_tag)' },
          webhookUrl: { type: 'string', description: 'Webhook URL (for webhook)' },
          condition: { type: 'string', description: 'Conditional logic JSON (e.g., {"tags": {"includes": "VIP"}})' },
        },
        required: ['sequenceId', 'sortOrder', 'action'],
      },
    },
    execute: async (args, companyId) => {
      const step = await sequencesService.addStep(
        companyId,
        args.sequenceId as string,
        {
          sortOrder: args.sortOrder as number | undefined,
          delayHours: (args.delayHours as number | undefined) ?? 24,
          action: args.action as string,
          message: args.message as string | undefined,
          templateId: args.templateId as string | undefined,
          tagName: args.tagName as string | undefined,
          webhookUrl: args.webhookUrl as string | undefined,
          condition: args.condition as string | undefined,
        },
        { type: 'ai' },
      );
      return `Added step ${step.sortOrder} (${step.action}) to sequence.`;
    },
  },
  {
    definition: {
      name: 'update_sequence_step',
      description: 'Update an existing step. Use stepId to identify it.',
      parameters: {
        type: 'object',
        properties: {
          stepId: { type: 'string' },
          delayHours: { type: 'number' },
          action: { type: 'string' },
          message: { type: 'string' },
          templateId: { type: 'string' },
          tagName: { type: 'string' },
          webhookUrl: { type: 'string' },
          condition: { type: 'string' },
        },
        required: ['stepId'],
      },
    },
    execute: async (args, companyId) => {
      await sequencesService.updateStep(
        companyId,
        args.stepId as string,
        {
          delayHours: args.delayHours as number | undefined,
          action: args.action as string | undefined,
          message: args.message as string | undefined,
          templateId: args.templateId as string | undefined,
          tagName: args.tagName as string | undefined,
          webhookUrl: args.webhookUrl as string | undefined,
          condition: args.condition as string | undefined,
        },
        { type: 'ai' },
      );
      return `Step updated.`;
    },
  },
  {
    definition: {
      name: 'remove_sequence_step',
      description: 'Remove a step from its sequence.',
      parameters: {
        type: 'object',
        properties: {
          stepId: { type: 'string' },
        },
        required: ['stepId'],
      },
    },
    execute: async (args, companyId) => {
      await sequencesService.removeStep(companyId, args.stepId as string, { type: 'ai' });
      return 'Step removed.';
    },
  },
  {
    definition: {
      name: 'reorder_sequence_steps',
      description: 'Reorder all steps in a sequence. Pass step IDs in new order.',
      parameters: {
        type: 'object',
        properties: {
          sequenceId: { type: 'string' },
          stepIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Step IDs in the desired order',
          },
        },
        required: ['sequenceId', 'stepIds'],
      },
    },
    execute: async (args, companyId) => {
      await sequencesService.reorderSteps(
        companyId,
        args.sequenceId as string,
        args.stepIds as string[],
        { type: 'ai' },
      );
      return 'Steps reordered.';
    },
  },

  // Enrollment Management Tools (7 tools)
  {
    definition: {
      name: 'list_enrollments',
      description: 'List enrollments for a sequence. Can filter by status.',
      parameters: {
        type: 'object',
        properties: {
          sequenceId: { type: 'string', description: 'Sequence to list enrollments for' },
          status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'COMPLETED', 'STOPPED', 'CANCELLED'], description: 'Filter by enrollment status' },
        },
        required: ['sequenceId'],
      },
    },
    execute: async (args, companyId) => {
      const enrollments = await sequencesService.getEnrollments(
        companyId,
        args.sequenceId as string,
        args.status as any,
      );
      if (!enrollments.length) return 'No enrollments found.';
      return enrollments.map((e) => {
        const contact = e.contact.displayName || e.contact.phoneNumber;
        const status = e.status.padEnd(10);
        const step = e.currentStep;
        const next = e.nextRunAt ? `next: ${new Date(e.nextRunAt).toLocaleDateString()}` : '';
        return `- [${status}] ${contact} · step ${step}${next ? ` · ${next}` : ''}`;
      }).join('\n');
    },
  },
  {
    definition: {
      name: 'get_enrollment_timeline',
      description: 'Get activity timeline for an enrollment.',
      parameters: {
        type: 'object',
        properties: {
          enrollmentId: { type: 'string' },
          limit: { type: 'number', description: 'Max activities (default 20)' },
        },
        required: ['enrollmentId'],
      },
    },
    execute: async (args, companyId) => {
      const activities = await sequencesService.getEnrollmentTimeline(
        companyId,
        args.enrollmentId as string,
        args.limit as number | undefined,
      );
      if (!activities.length) return 'No activity recorded.';
      return activities.map((a) => {
        const date = new Date(a.createdAt).toLocaleString();
        return `${date} · ${a.type} · ${a.title}${a.body ? `\n  ${a.body}` : ''}`;
      }).join('\n');
    },
  },
  {
    definition: {
      name: 'enroll_contact_in_sequence',
      description: 'Enroll a contact in a sequence. Provide either contactId or phoneNumber to look up the contact.',
      parameters: {
        type: 'object',
        properties: {
          sequenceId: { type: 'string' },
          contactId: { type: 'string', description: 'Contact ID (preferred)' },
          phoneNumber: { type: 'string', description: 'Phone number to look up contact' },
          startAt: { type: 'string', description: 'ISO datetime to start (optional, defaults to now)' },
        },
        required: ['sequenceId'],
      },
    },
    execute: async (args, companyId) => {
      const enrollment = await sequencesService.enrollContact(
        companyId,
        args.sequenceId as string,
        {
          contactId: args.contactId as string | undefined,
          phoneNumber: args.phoneNumber as string | undefined,
          startAt: args.startAt ? new Date(args.startAt as string) : undefined,
        },
        { type: 'ai' },
      );
      return `Enrolled ${enrollment.contact.displayName || enrollment.contact.phoneNumber} in sequence. First step runs at ${new Date(enrollment.nextRunAt!).toLocaleString()}.`;
    },
  },
  {
    definition: {
      name: 'unenroll_contact_from_sequence',
      description: 'Remove a contact from a sequence. This cancels the enrollment.',
      parameters: {
        type: 'object',
        properties: {
          enrollmentId: { type: 'string' },
        },
        required: ['enrollmentId'],
      },
    },
    execute: async (args, companyId) => {
      await sequencesService.unenrollContact(companyId, args.enrollmentId as string, { type: 'ai' });
      return 'Contact unenrolled from sequence.';
    },
  },
  {
    definition: {
      name: 'pause_enrollment',
      description: 'Pause an active enrollment. The contact will not receive further messages until resumed.',
      parameters: {
        type: 'object',
        properties: {
          enrollmentId: { type: 'string' },
          reason: { type: 'string', description: 'Why pausing' },
        },
        required: ['enrollmentId'],
      },
    },
    execute: async (args, companyId) => {
      await sequencesService.pauseEnrollment(
        companyId,
        args.enrollmentId as string,
        args.reason as string | undefined,
        { type: 'ai' },
      );
      return 'Enrollment paused.';
    },
  },
  {
    definition: {
      name: 'resume_enrollment',
      description: 'Resume a paused enrollment. Recalculates nextRunAt from current step.',
      parameters: {
        type: 'object',
        properties: {
          enrollmentId: { type: 'string' },
        },
        required: ['enrollmentId'],
      },
    },
    execute: async (args, companyId) => {
      await sequencesService.resumeEnrollment(companyId, args.enrollmentId as string, { type: 'ai' });
      return 'Enrollment resumed.';
    },
  },
  {
    definition: {
      name: 'stop_enrollment',
      description: 'Stop an enrollment permanently. Cannot be resumed.',
      parameters: {
        type: 'object',
        properties: {
          enrollmentId: { type: 'string' },
          reason: { type: 'string', description: 'Why stopping' },
        },
        required: ['enrollmentId'],
      },
    },
    execute: async (args, companyId) => {
      await sequencesService.stopEnrollment(
        companyId,
        args.enrollmentId as string,
        { type: 'ai' },
        args.reason as string | undefined,
      );
      return 'Enrollment stopped.';
    },
  },

  // Bulk Operations (3 tools)
  {
    definition: {
      name: 'bulk_enroll_contacts',
      description: 'Enroll multiple contacts in a sequence at once.',
      parameters: {
        type: 'object',
        properties: {
          sequenceId: { type: 'string' },
          contactIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Contact IDs to enroll',
          },
        },
        required: ['sequenceId', 'contactIds'],
      },
    },
    execute: async (args, companyId) => {
      const result = await sequencesService.bulkEnroll(
        companyId,
        args.sequenceId as string,
        args.contactIds as string[],
        { type: 'ai' },
      );
      return `Enrolled ${result.successful} contacts. Failed: ${result.failed}.`;
    },
  },
  {
    definition: {
      name: 'bulk_unenroll_contacts',
      description: 'Unenroll multiple contacts at once.',
      parameters: {
        type: 'object',
        properties: {
          enrollmentIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Enrollment IDs to cancel',
          },
        },
        required: ['enrollmentIds'],
      },
    },
    execute: async (args, companyId) => {
      const enrollmentIds = args.enrollmentIds as string[];
      await sequencesService.bulkUnenroll(companyId, enrollmentIds, { type: 'ai' });
      return `Unenrolled ${enrollmentIds.length} contacts.`;
    },
  },
  {
    definition: {
      name: 'bulk_pause_enrollments',
      description: 'Pause multiple enrollments at once.',
      parameters: {
        type: 'object',
        properties: {
          enrollmentIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Enrollment IDs to pause',
          },
        },
        required: ['enrollmentIds'],
      },
    },
    execute: async (args, companyId) => {
      const enrollmentIds = args.enrollmentIds as string[];
      await sequencesService.bulkPauseEnrollments(companyId, enrollmentIds, { type: 'ai' });
      return `Paused ${enrollmentIds.length} enrollments.`;
    },
  },

  // Smart Features with OpenClaw Memory (2 tools)
  {
    definition: {
      name: 'suggest_sequence',
      description: 'Search memory for similar sequences based on context. Uses semantic search + completion rate scoring.',
      parameters: {
        type: 'object',
        properties: {
          context: { type: 'string', description: 'Describe the use case (e.g., "follow up after demo")' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tag filters' },
        },
        required: ['context'],
      },
    },
    execute: async (args, companyId) => {
      const suggestions = await sequenceMemoryService.suggestSequenceForContext(
        companyId,
        args.context as string,
        args.tags as string[] | undefined,
      );
      if (!suggestions.length) return 'No similar sequences found in memory.';
      return [
        `Found ${suggestions.length} similar sequence(s):`,
        ...suggestions.map((s) => {
          return `- ${s.sequence.name}: ${s.reason}`;
        }),
      ].join('\n');
    },
  },
  {
    definition: {
      name: 'learn_from_sequence',
      description: 'Store a successful sequence pattern in long-term memory. Only works for sequences with 80%+ completion rate.',
      parameters: {
        type: 'object',
        properties: {
          sequenceId: { type: 'string', description: 'Sequence to learn from' },
        },
        required: ['sequenceId'],
      },
    },
    execute: async (args, _companyId) => {
      await sequenceMemoryService.learnFromSequence(args.sequenceId as string);
      return 'Analyzed sequence. If completion rate ≥80%, pattern stored in memory.';
    },
  },

  // ── Pipelines ─────────────────────────────────────────────────────────────
  {
    definition: { name: 'create_pipeline', description: 'Create a new sales pipeline with stages.', parameters: { type: 'object', properties: { name: { type: 'string' }, stages: { type: 'array', items: { type: 'string' }, description: 'Stage names in order' } }, required: ['name', 'stages'] } },
    execute: async (args, companyId) => {
      const p = await prisma.pipeline.create({ data: { companyId, name: args.name as string } });
      const stages = (args.stages as string[]) || [];
      for (let i = 0; i < stages.length; i++) {
        await prisma.pipelineStage.create({ data: { pipelineId: p.id, name: stages[i], sortOrder: i, probability: Math.round((i / stages.length) * 100) } });
      }
      return `Created pipeline "${p.name}" with ${stages.length} stages`;
    },
  },

  // ── Products (full catalog management, all routed through ProductsService)
  {
    definition: {
      name: 'list_products',
      description: 'List products in the catalog with rich filters. By default returns active, non-archived products.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Free-text search over name / description / sku / barcode' },
          category: { type: 'string' },
          tag: { type: 'string' },
          isActive: { type: 'boolean' },
          archived: { type: 'boolean', description: 'Include archived products' },
          inStockOnly: { type: 'boolean' },
          priceMin: { type: 'number', description: 'Minimum price in smallest unit (paise/cents)' },
          priceMax: { type: 'number' },
          sort: { type: 'string', enum: ['recent', 'name', 'price', 'stock', 'sold'] },
          limit: { type: 'number' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      const result = await productsService.list(companyId, {
        isActive: args.isActive as boolean | undefined,
        category: args.category as string | undefined,
        tag: args.tag as string | undefined,
        search: args.search as string | undefined,
        priceMin: args.priceMin as number | undefined,
        priceMax: args.priceMax as number | undefined,
        inStockOnly: args.inStockOnly as boolean | undefined,
        archived: args.archived as boolean | undefined,
        sort: args.sort as never,
        limit: (args.limit as number) ?? 20,
      });
      if (!result.items.length) return 'No products match those filters.';
      return [
        `Found ${result.total} product(s) (showing ${result.items.length}):`,
        ...result.items.map((p) => {
          const price = `${p.currency} ${(p.price / 100).toFixed(2)}`;
          const stock = p.trackInventory ? ` · stock ${p.stock}` : '';
          const sku = p.sku ? ` · SKU ${p.sku}` : '';
          return `- ${p.name} · ${price}${stock}${sku} · ID: ${p.id}`;
        }),
      ].join('\n');
    },
  },
  {
    definition: {
      name: 'get_product',
      description: 'Fetch a product with its variants, last 10 timeline activities, and full details.',
      parameters: {
        type: 'object',
        properties: { productId: { type: 'string' } },
        required: ['productId'],
      },
    },
    execute: async (args, companyId) => {
      const p = await productsService.get(companyId, args.productId as string);
      const variants = (Array.isArray(p.variants) ? p.variants : []) as Array<{ id: string; name: string; price?: number; stock?: number }>;
      const recent = p.activities.slice(0, 10);
      const lines = [
        `Product "${p.name}" (ID: ${p.id})`,
        `Price: ${p.currency} ${(p.price / 100).toFixed(2)}${p.costPrice ? ` · Cost: ${(p.costPrice / 100).toFixed(2)}` : ''}`,
        p.sku ? `SKU: ${p.sku}` : '',
        p.barcode ? `Barcode: ${p.barcode}` : '',
        p.category ? `Category: ${p.category}` : '',
        p.tags.length ? `Tags: ${p.tags.join(', ')}` : '',
        p.trackInventory ? `Stock: ${p.stock}${p.reorderLevel > 0 ? ` (reorder at ${p.reorderLevel})` : ''}` : 'Inventory not tracked',
        `Status: ${p.archivedAt ? 'ARCHIVED' : p.isActive ? 'active' : 'inactive'}`,
        p.totalSold ? `Total sold: ${p.totalSold}` : '',
        variants.length ? `Variants: ${variants.length}` : '',
        '',
        'Recent activity:',
        ...recent.map((a) => `  • ${a.createdAt.toISOString().slice(0, 16)} [${a.type}] ${a.title}`),
      ].filter(Boolean);
      return lines.join('\n');
    },
  },
  {
    definition: {
      name: 'create_product',
      description: 'Create a new product in the catalog. Prices are in the smallest currency unit (paise/cents).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          price: { type: 'number', description: 'Price in smallest unit (paise/cents)' },
          costPrice: { type: 'number', description: 'Cost in smallest unit, used to compute margin' },
          currency: { type: 'string', description: 'ISO code, defaults to INR' },
          sku: { type: 'string' },
          barcode: { type: 'string' },
          category: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          trackInventory: { type: 'boolean' },
          stock: { type: 'number' },
          reorderLevel: { type: 'number' },
          images: { type: 'array', items: { type: 'string' } },
          isActive: { type: 'boolean' },
        },
        required: ['name', 'price'],
      },
    },
    execute: async (args, companyId) => {
      const p = await productsService.create(
        companyId,
        {
          name: args.name as string,
          description: args.description as string | undefined,
          price: args.price as number,
          costPrice: args.costPrice as number | undefined,
          currency: args.currency as string | undefined,
          sku: args.sku as string | undefined,
          barcode: args.barcode as string | undefined,
          category: args.category as string | undefined,
          tags: args.tags as string[] | undefined,
          trackInventory: args.trackInventory as boolean | undefined,
          stock: args.stock as number | undefined,
          reorderLevel: args.reorderLevel as number | undefined,
          images: args.images as string[] | undefined,
          isActive: args.isActive as boolean | undefined,
        },
        AI_PRODUCT_ACTOR,
      );
      return `Created product "${p.name}" (ID: ${p.id}, ${p.currency} ${(p.price / 100).toFixed(2)})`;
    },
  },
  {
    definition: {
      name: 'update_product',
      description: 'Update arbitrary product fields. Field-level changes are diffed and logged.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          price: { type: 'number' },
          costPrice: { type: 'number' },
          currency: { type: 'string' },
          sku: { type: 'string' },
          barcode: { type: 'string' },
          category: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          trackInventory: { type: 'boolean' },
          reorderLevel: { type: 'number' },
          isActive: { type: 'boolean' },
        },
        required: ['productId'],
      },
    },
    execute: async (args, companyId) => {
      const p = await productsService.update(
        companyId,
        args.productId as string,
        {
          name: args.name as string | undefined,
          description: args.description as string | undefined,
          price: args.price as number | undefined,
          costPrice: args.costPrice as number | undefined,
          currency: args.currency as string | undefined,
          sku: args.sku as string | undefined,
          barcode: args.barcode as string | undefined,
          category: args.category as string | undefined,
          tags: args.tags as string[] | undefined,
          trackInventory: args.trackInventory as boolean | undefined,
          reorderLevel: args.reorderLevel as number | undefined,
          isActive: args.isActive as boolean | undefined,
        },
        AI_PRODUCT_ACTOR,
      );
      return `Updated product "${p.name}"`;
    },
  },
  {
    definition: {
      name: 'set_product_price',
      description: 'Set a product\'s price (in smallest currency unit, e.g. 9999 = ₹99.99).',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string' },
          price: { type: 'number', description: 'New price in smallest unit (paise/cents)' },
        },
        required: ['productId', 'price'],
      },
    },
    execute: async (args, companyId) => {
      const p = await productsService.update(
        companyId,
        args.productId as string,
        { price: args.price as number },
        AI_PRODUCT_ACTOR,
      );
      return `Set price of "${p.name}" to ${p.currency} ${(p.price / 100).toFixed(2)}`;
    },
  },
  {
    definition: {
      name: 'adjust_product_stock',
      description: 'Adjust a product\'s stock by delta. Positive to add inventory, negative to subtract. Pass `variantId` to target a specific variant.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string' },
          delta: { type: 'number', description: 'Positive to add, negative to subtract' },
          reason: { type: 'string' },
          variantId: { type: 'string' },
        },
        required: ['productId', 'delta'],
      },
    },
    execute: async (args, companyId) => {
      const p = await productsService.adjustStock(
        companyId,
        args.productId as string,
        {
          delta: args.delta as number,
          reason: args.reason as string | undefined,
          variantId: args.variantId as string | undefined,
        },
        AI_PRODUCT_ACTOR,
      );
      return `Adjusted "${p.name}" stock by ${args.delta as number} → ${p.stock}`;
    },
  },
  {
    definition: {
      name: 'set_product_stock',
      description: 'Set a product\'s stock to an absolute value.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string' },
          stock: { type: 'number' },
          reason: { type: 'string' },
          variantId: { type: 'string' },
        },
        required: ['productId', 'stock'],
      },
    },
    execute: async (args, companyId) => {
      const p = await productsService.setStock(
        companyId,
        args.productId as string,
        {
          stock: args.stock as number,
          reason: args.reason as string | undefined,
          variantId: args.variantId as string | undefined,
        },
        AI_PRODUCT_ACTOR,
      );
      return `Set "${p.name}" stock to ${p.stock}`;
    },
  },
  {
    definition: {
      name: 'tag_product',
      description: 'Add a tag to a product.',
      parameters: {
        type: 'object',
        properties: { productId: { type: 'string' }, tag: { type: 'string' } },
        required: ['productId', 'tag'],
      },
    },
    execute: async (args, companyId) => {
      const p = await productsService.addTag(companyId, args.productId as string, args.tag as string, AI_PRODUCT_ACTOR);
      return `Tagged "${p.name}" with "${args.tag as string}"`;
    },
  },
  {
    definition: {
      name: 'untag_product',
      description: 'Remove a tag from a product.',
      parameters: {
        type: 'object',
        properties: { productId: { type: 'string' }, tag: { type: 'string' } },
        required: ['productId', 'tag'],
      },
    },
    execute: async (args, companyId) => {
      const p = await productsService.removeTag(companyId, args.productId as string, args.tag as string, AI_PRODUCT_ACTOR);
      return `Removed tag "${args.tag as string}" from "${p.name}"`;
    },
  },
  {
    definition: {
      name: 'archive_product',
      description: 'Archive a product (hides from active catalog without deleting).',
      parameters: {
        type: 'object',
        properties: { productId: { type: 'string' } },
        required: ['productId'],
      },
    },
    execute: async (args, companyId) => {
      const p = await productsService.archive(companyId, args.productId as string, AI_PRODUCT_ACTOR);
      return `Archived "${p.name}"`;
    },
  },
  {
    definition: {
      name: 'unarchive_product',
      description: 'Restore an archived product back to the active catalog.',
      parameters: {
        type: 'object',
        properties: { productId: { type: 'string' } },
        required: ['productId'],
      },
    },
    execute: async (args, companyId) => {
      const p = await productsService.unarchive(companyId, args.productId as string, AI_PRODUCT_ACTOR);
      return `Unarchived "${p.name}"`;
    },
  },
  {
    definition: {
      name: 'delete_product',
      description: 'Delete a product. If it\'s referenced by any deal line item, it will be archived instead of hard-deleted.',
      parameters: {
        type: 'object',
        properties: { productId: { type: 'string' } },
        required: ['productId'],
      },
    },
    execute: async (args, companyId) => {
      await productsService.delete(companyId, args.productId as string, AI_PRODUCT_ACTOR);
      return `Removed product ${args.productId as string}`;
    },
  },
  {
    definition: {
      name: 'add_product_variant',
      description: 'Add a variant (size/color/material) to a product. Variants can override the base price and stock.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string' },
          name: { type: 'string', description: 'Variant name e.g. "Red - Large"' },
          sku: { type: 'string' },
          price: { type: 'number', description: 'Override price in smallest unit' },
          stock: { type: 'number', description: 'Variant stock count' },
        },
        required: ['productId', 'name'],
      },
    },
    execute: async (args, companyId) => {
      const p = await productsService.addVariant(
        companyId,
        args.productId as string,
        {
          name: args.name as string,
          sku: args.sku as string | undefined,
          price: args.price as number | undefined,
          stock: args.stock as number | undefined,
        },
        AI_PRODUCT_ACTOR,
      );
      return `Added variant "${args.name as string}" to "${p.name}"`;
    },
  },
  {
    definition: {
      name: 'remove_product_variant',
      description: 'Remove a variant from a product.',
      parameters: {
        type: 'object',
        properties: { productId: { type: 'string' }, variantId: { type: 'string' } },
        required: ['productId', 'variantId'],
      },
    },
    execute: async (args, companyId) => {
      const p = await productsService.removeVariant(companyId, args.productId as string, args.variantId as string, AI_PRODUCT_ACTOR);
      return `Removed variant from "${p.name}"`;
    },
  },
  {
    definition: {
      name: 'get_product_timeline',
      description: 'Fetch the activity timeline for a product (newest first).',
      parameters: {
        type: 'object',
        properties: { productId: { type: 'string' }, limit: { type: 'number' } },
        required: ['productId'],
      },
    },
    execute: async (args, companyId) => {
      const items = await productsService.getTimeline(companyId, args.productId as string, (args.limit as number) ?? 20);
      if (!items.length) return 'No timeline activity yet.';
      return items
        .map((a) => `- ${a.createdAt.toISOString().slice(0, 16)} [${a.type}] ${a.title}${a.body ? `\n    ${a.body}` : ''}`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'get_product_stats',
      description: 'Catalog stats — total / active / archived counts, low stock and out-of-stock counts, category breakdown, total catalog value.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    execute: async (_args, companyId) => {
      const s = await productsService.stats(companyId);
      return [
        'Catalog stats',
        `Total: ${s.total} (${s.active} active, ${s.archived} archived)`,
        `Low stock: ${s.lowStock}`,
        `Out of stock: ${s.outOfStock}`,
        `Catalog value: ${(s.catalogValue / 100).toLocaleString()}`,
        `By category: ${Object.entries(s.byCategory).map(([k, v]) => `${k}=${v}`).join(', ')}`,
      ].join('\n');
    },
  },
  {
    definition: {
      name: 'list_low_stock_products',
      description: 'List products whose inventory is at or below the reorder level. Use this when the user asks "what needs restocking".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    execute: async (_args, companyId) => {
      const items = await productsService.findLowStockProducts(companyId);
      if (!items.length) return 'No products are low on stock.';
      return items
        .map((p) => `- "${p.name}" · stock ${p.stock} (reorder at ${p.reorderLevel}) · ID: ${p.id}`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'bulk_archive_products',
      description: 'Archive many products at once.',
      parameters: {
        type: 'object',
        properties: { productIds: { type: 'array', items: { type: 'string' } } },
        required: ['productIds'],
      },
    },
    execute: async (args, companyId) => {
      const result = await productsService.bulkArchive(companyId, args.productIds as string[], AI_PRODUCT_ACTOR);
      return `Bulk archive: ${result.updated}/${result.requested} archived`;
    },
  },
  {
    definition: {
      name: 'bulk_set_product_category',
      description: 'Set the category of many products at once. Pass `category: null` to clear.',
      parameters: {
        type: 'object',
        properties: {
          productIds: { type: 'array', items: { type: 'string' } },
          category: { type: 'string' },
        },
        required: ['productIds'],
      },
    },
    execute: async (args, companyId) => {
      const result = await productsService.bulkSetCategory(
        companyId,
        args.productIds as string[],
        (args.category as string | null) ?? null,
        AI_PRODUCT_ACTOR,
      );
      return `Bulk category: ${result.updated}/${result.requested} updated`;
    },
  },

  // ── Quotes (full lifecycle — 22 tools) ───────────────────────────────────
  {
    definition: {
      name: 'list_quotes',
      description: 'List quotes with filters. Money is in minor units (paise/cents). Use get_quote for detail.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Comma-separated: DRAFT, SENT, VIEWED, ACCEPTED, REJECTED, EXPIRED, REVOKED' },
          contactId: { type: 'string' },
          dealId: { type: 'string' },
          tag: { type: 'string' },
          search: { type: 'string' },
          sort: { type: 'string', enum: ['recent', 'total', 'number', 'valid_until'] },
          page: { type: 'number' },
          limit: { type: 'number' },
        },
      },
    },
    execute: async (args, companyId) => {
      const filters: ListQuotesFilters = {
        status: args.status ? (String(args.status).split(',') as never) : undefined,
        contactId: args.contactId as string | undefined,
        dealId: args.dealId as string | undefined,
        tag: args.tag as string | undefined,
        search: args.search as string | undefined,
        sort: args.sort as ListQuotesFilters['sort'],
        page: typeof args.page === 'number' ? args.page : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      };
      const { items, total } = await quotesService.list(companyId, filters);
      if (items.length === 0) return 'No quotes match.';
      return `${items.length}/${total} quotes:\n` + items
        .map((q) => `- [${q.status}] ${q.quoteNumber} · ${formatMinor(q.total, q.currency)} · ${q.lineItems.length} items${q.validUntil ? ' · valid until ' + new Date(q.validUntil).toLocaleDateString() : ''} (id: ${q.id})`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'get_quote',
      description: 'Get full quote details including line items, totals, and recent activity.',
      parameters: { type: 'object', properties: { quoteId: { type: 'string' } }, required: ['quoteId'] },
    },
    execute: async (args, companyId) => {
      const q = await quotesService.get(companyId, args.quoteId as string);
      return JSON.stringify({
        id: q.id,
        quoteNumber: q.quoteNumber,
        title: q.title,
        status: q.status,
        contactId: q.contactId,
        dealId: q.dealId,
        currency: q.currency,
        subtotal: q.subtotal,
        tax: q.tax,
        taxBps: q.taxBps,
        discount: q.discount,
        total: q.total,
        totalFormatted: formatMinor(q.total, q.currency),
        validUntil: q.validUntil,
        sentAt: q.sentAt,
        viewedAt: q.viewedAt,
        acceptedAt: q.acceptedAt,
        rejectedAt: q.rejectedAt,
        autoMoveDealOnAccept: q.autoMoveDealOnAccept,
        lineItems: q.lineItems.map((li) => ({
          id: li.id,
          name: li.name,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          discountBps: li.discountBps,
          total: li.total,
          totalFormatted: formatMinor(li.total, q.currency),
        })),
        publicUrl: `/public/quotes/${q.publicToken}`,
        recentActivity: q.activities.map((a) => `[${a.createdAt.toISOString()}] ${a.type} — ${a.title}`),
      }, null, 2);
    },
  },
  {
    definition: {
      name: 'create_quote',
      description: 'Create a quote in DRAFT status. Money is in minor units (e.g. 50000 = ₹500.00). You can pass initial lineItems OR call add_quote_line_item afterwards. The quoteNumber is auto-generated unless provided.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          dealId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          currency: { type: 'string', description: 'ISO code, default INR' },
          taxBps: { type: 'number', description: 'Tax percent in basis points 0-10000 (e.g. 1800 = 18%)' },
          discount: { type: 'number', description: 'Quote-level flat discount in minor units' },
          validUntil: { type: 'string', description: 'ISO-8601 date' },
          notes: { type: 'string' },
          terms: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          autoMoveDealOnAccept: { type: 'boolean', description: 'When true, linked Deal auto-moves to WON on customer acceptance' },
          lineItems: {
            type: 'array',
            description: 'Initial line items. Each: {name, quantity, unitPrice (minor units), discountBps?}',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                quantity: { type: 'number' },
                unitPrice: { type: 'number' },
                discountBps: { type: 'number' },
                productId: { type: 'string' },
              },
              required: ['name'],
            },
          },
        },
      },
    },
    execute: async (args, companyId) => {
      const dto: CreateQuoteDto = {
        contactId: args.contactId as string | undefined,
        dealId: args.dealId as string | undefined,
        title: args.title as string | undefined,
        description: args.description as string | undefined,
        currency: args.currency as string | undefined,
        taxBps: typeof args.taxBps === 'number' ? args.taxBps : undefined,
        discount: typeof args.discount === 'number' ? args.discount : undefined,
        validUntil: args.validUntil as string | undefined,
        notes: args.notes as string | undefined,
        terms: args.terms as string | undefined,
        tags: (args.tags as string[] | undefined) ?? undefined,
        autoMoveDealOnAccept: args.autoMoveDealOnAccept as boolean | undefined,
        lineItems: (args.lineItems as LineItemInput[] | undefined) ?? [],
      };
      const q = await quotesService.create(companyId, AI_QUOTE_ACTOR, dto);
      return `Created quote ${q.quoteNumber} (DRAFT) — total ${formatMinor(q.total, q.currency)}. id: ${q.id}`;
    },
  },
  {
    definition: {
      name: 'update_quote',
      description: 'Update quote metadata (title, tax, discount, validUntil, etc). Only works on DRAFT or SENT quotes.',
      parameters: {
        type: 'object',
        properties: {
          quoteId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          contactId: { type: 'string' },
          dealId: { type: 'string' },
          taxBps: { type: 'number' },
          discount: { type: 'number' },
          currency: { type: 'string' },
          validUntil: { type: 'string' },
          notes: { type: 'string' },
          terms: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          autoMoveDealOnAccept: { type: 'boolean' },
        },
        required: ['quoteId'],
      },
    },
    execute: async (args, companyId) => {
      const { quoteId, ...rest } = args;
      const q = await quotesService.update(
        companyId,
        quoteId as string,
        AI_QUOTE_ACTOR,
        rest as UpdateQuoteDto,
      );
      return `Updated quote ${q.quoteNumber} — total ${formatMinor(q.total, q.currency)}`;
    },
  },
  {
    definition: {
      name: 'add_quote_line_item',
      description: 'Append a line item to a DRAFT or SENT quote. Recomputes totals automatically. Money in minor units.',
      parameters: {
        type: 'object',
        properties: {
          quoteId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          quantity: { type: 'number' },
          unitPrice: { type: 'number', description: 'Minor units (e.g. 50000 = ₹500.00)' },
          discountBps: { type: 'number', description: 'Per-line discount bps 0-10000' },
          productId: { type: 'string' },
        },
        required: ['quoteId', 'name'],
      },
    },
    execute: async (args, companyId) => {
      const { quoteId, ...item } = args;
      const q = await quotesService.addLineItem(
        companyId,
        quoteId as string,
        AI_QUOTE_ACTOR,
        item as unknown as LineItemInput,
      );
      return `Added "${item.name as string}" — new total ${formatMinor(q.total, q.currency)}`;
    },
  },
  {
    definition: {
      name: 'update_quote_line_item',
      description: 'Update a line item on a quote. Pass only the fields you want to change.',
      parameters: {
        type: 'object',
        properties: {
          quoteId: { type: 'string' },
          lineItemId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          quantity: { type: 'number' },
          unitPrice: { type: 'number' },
          discountBps: { type: 'number' },
        },
        required: ['quoteId', 'lineItemId'],
      },
    },
    execute: async (args, companyId) => {
      const { quoteId, lineItemId, ...patch } = args;
      const q = await quotesService.updateLineItem(
        companyId,
        quoteId as string,
        AI_QUOTE_ACTOR,
        lineItemId as string,
        patch as Partial<LineItemInput>,
      );
      return `Updated line item — new total ${formatMinor(q.total, q.currency)}`;
    },
  },
  {
    definition: {
      name: 'remove_quote_line_item',
      description: 'Remove a line item from a quote.',
      parameters: {
        type: 'object',
        properties: {
          quoteId: { type: 'string' },
          lineItemId: { type: 'string' },
        },
        required: ['quoteId', 'lineItemId'],
      },
    },
    execute: async (args, companyId) => {
      const q = await quotesService.removeLineItem(
        companyId,
        args.quoteId as string,
        AI_QUOTE_ACTOR,
        args.lineItemId as string,
      );
      return `Removed line item — new total ${formatMinor(q.total, q.currency)}`;
    },
  },
  {
    definition: {
      name: 'send_quote',
      description: 'Transition a DRAFT quote to SENT. After sending, you can share the public URL returned by get_quote so the customer can view/accept/reject it.',
      parameters: { type: 'object', properties: { quoteId: { type: 'string' } }, required: ['quoteId'] },
    },
    execute: async (args, companyId) => {
      const q = await quotesService.send(companyId, args.quoteId as string, AI_QUOTE_ACTOR);
      return `Sent ${q.quoteNumber}. Public URL path: /public/quotes/${q.publicToken}`;
    },
  },
  {
    definition: {
      name: 'accept_quote',
      description: 'Accept a SENT or VIEWED quote on behalf of the customer (rare — usually the customer clicks Accept on the public URL).',
      parameters: { type: 'object', properties: { quoteId: { type: 'string' } }, required: ['quoteId'] },
    },
    execute: async (args, companyId) => {
      const q = await quotesService.accept(companyId, args.quoteId as string, AI_QUOTE_ACTOR);
      return `Accepted ${q.quoteNumber}${q.autoMoveDealOnAccept && q.dealId ? ' — linked deal moved to WON' : ''}`;
    },
  },
  {
    definition: {
      name: 'reject_quote',
      description: 'Reject a SENT or VIEWED quote. Always pass a reason.',
      parameters: {
        type: 'object',
        properties: {
          quoteId: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['quoteId'],
      },
    },
    execute: async (args, companyId) => {
      const q = await quotesService.reject(
        companyId,
        args.quoteId as string,
        AI_QUOTE_ACTOR,
        args.reason as string | undefined,
      );
      return `Rejected ${q.quoteNumber}`;
    },
  },
  {
    definition: {
      name: 'revoke_quote',
      description: 'Revoke an active quote — the customer will no longer be able to view it via the public URL. Cannot undo.',
      parameters: {
        type: 'object',
        properties: {
          quoteId: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['quoteId'],
      },
    },
    execute: async (args, companyId) => {
      const q = await quotesService.revoke(
        companyId,
        args.quoteId as string,
        AI_QUOTE_ACTOR,
        args.reason as string | undefined,
      );
      return `Revoked ${q.quoteNumber}`;
    },
  },
  {
    definition: {
      name: 'expire_quote',
      description: 'Manually mark a quote as EXPIRED. Useful when the validUntil has passed and nobody cleaned it up.',
      parameters: { type: 'object', properties: { quoteId: { type: 'string' } }, required: ['quoteId'] },
    },
    execute: async (args, companyId) => {
      const q = await quotesService.expire(companyId, args.quoteId as string, AI_QUOTE_ACTOR);
      return `${q.quoteNumber} → EXPIRED`;
    },
  },
  {
    definition: {
      name: 'duplicate_quote',
      description: 'Clone a quote as a new DRAFT with the same line items and terms. Useful for creating variations.',
      parameters: { type: 'object', properties: { quoteId: { type: 'string' } }, required: ['quoteId'] },
    },
    execute: async (args, companyId) => {
      const q = await quotesService.duplicate(companyId, args.quoteId as string, AI_QUOTE_ACTOR);
      return `Duplicated — new quote ${q.quoteNumber} (DRAFT). id: ${q.id}`;
    },
  },
  {
    definition: {
      name: 'add_quote_note',
      description: 'Drop a note on the quote timeline.',
      parameters: {
        type: 'object',
        properties: { quoteId: { type: 'string' }, body: { type: 'string' } },
        required: ['quoteId', 'body'],
      },
    },
    execute: async (args, companyId) => {
      await quotesService.addNote(
        companyId,
        args.quoteId as string,
        AI_QUOTE_ACTOR,
        args.body as string,
      );
      return `Note added`;
    },
  },
  {
    definition: {
      name: 'delete_quote',
      description: 'Permanently delete a quote. Only DRAFT, REVOKED, or EXPIRED quotes can be deleted.',
      parameters: { type: 'object', properties: { quoteId: { type: 'string' } }, required: ['quoteId'] },
    },
    execute: async (args, companyId) => {
      await quotesService.remove(companyId, args.quoteId as string);
      return `Deleted`;
    },
  },
  {
    definition: {
      name: 'get_quote_stats',
      description: 'Get aggregate quote stats across all quotes created in the last N days — value, acceptance rate, by status.',
      parameters: {
        type: 'object',
        properties: { days: { type: 'number', description: 'Lookback window. Default 30.' } },
      },
    },
    execute: async (args, companyId) => {
      const s = await quotesService.stats(
        companyId,
        typeof args.days === 'number' ? args.days : 30,
      );
      return `Quotes (${s.rangeDays}d): ${s.totalQuotes} total. Value ${formatMinor(s.totalValue)} · Accepted ${formatMinor(s.acceptedValue)}\n` +
        `Acceptance rate: ${s.acceptanceRate ?? 'n/a'}% · Average: ${s.averageValue !== null ? formatMinor(s.averageValue) : 'n/a'}\n` +
        `By status: ${Object.entries(s.byStatus).map(([k, v]) => `${k}=${v}`).join(' · ') || '(none)'}`;
    },
  },
  {
    definition: {
      name: 'get_quote_timeline',
      description: 'Fetch the activity timeline for a quote (most recent first).',
      parameters: {
        type: 'object',
        properties: {
          quoteId: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['quoteId'],
      },
    },
    execute: async (args, companyId) => {
      const events = await quotesService.getTimeline(
        companyId,
        args.quoteId as string,
        typeof args.limit === 'number' ? args.limit : 30,
      );
      if (events.length === 0) return 'No activity.';
      return events
        .map((e) => `[${e.createdAt.toISOString()}] ${e.type} (${e.actorType}) — ${e.title}${e.body ? '\n  ' + e.body : ''}`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'get_quote_public_url',
      description: 'Get the hosted public URL for a quote — the link to share with the customer so they can view and accept/reject.',
      parameters: { type: 'object', properties: { quoteId: { type: 'string' } }, required: ['quoteId'] },
    },
    execute: async (args, companyId) => {
      const q = await quotesService.get(companyId, args.quoteId as string);
      if (q.status === 'DRAFT') {
        return `MEMORY_SEARCH_UNAVAILABLE: quote is still in DRAFT. Call send_quote first.`;
      }
      const publicUrl = process.env.API_PUBLIC_URL?.replace(/\/$/, '');
      if (!publicUrl) {
        return `/public/quotes/${q.publicToken} (API_PUBLIC_URL env var is not set — absolute URL not available; share the relative path)`;
      }
      return `${publicUrl}/public/quotes/${q.publicToken}`;
    },
  },
  {
    definition: {
      name: 'bulk_send_quotes',
      description: 'Send multiple DRAFT quotes at once.',
      parameters: { type: 'object', properties: { quoteIds: { type: 'array', items: { type: 'string' } } }, required: ['quoteIds'] },
    },
    execute: async (args, companyId) => {
      const r = await quotesService.bulkSend(
        companyId,
        args.quoteIds as string[],
        AI_QUOTE_ACTOR,
      );
      return `Sent ${r.updated}, failed ${r.failed}.`;
    },
  },
  {
    definition: {
      name: 'bulk_revoke_quotes',
      description: 'Revoke multiple quotes at once.',
      parameters: {
        type: 'object',
        properties: {
          quoteIds: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
        required: ['quoteIds'],
      },
    },
    execute: async (args, companyId) => {
      const r = await quotesService.bulkRevoke(
        companyId,
        args.quoteIds as string[],
        AI_QUOTE_ACTOR,
        args.reason as string | undefined,
      );
      return `Revoked ${r.updated}, failed ${r.failed}.`;
    },
  },
  {
    definition: {
      name: 'bulk_delete_quotes',
      description: 'Permanently delete multiple quotes. Only DRAFT/REVOKED/EXPIRED will actually be removed.',
      parameters: { type: 'object', properties: { quoteIds: { type: 'array', items: { type: 'string' } } }, required: ['quoteIds'] },
    },
    execute: async (args, companyId) => {
      const r = await quotesService.bulkDelete(companyId, args.quoteIds as string[]);
      return `Deleted ${r.updated}, failed ${r.failed}.`;
    },
  },

  // ── Invoices (full lifecycle — 22 tools) ─────────────────────────────────
  {
    definition: {
      name: 'list_invoices',
      description: 'List invoices with filters. Money in minor units (paise/cents). Use get_invoice for detail.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Comma-separated: DRAFT, SENT, VIEWED, PARTIALLY_PAID, PAID, OVERDUE, CANCELLED, VOID' },
          contactId: { type: 'string' },
          dealId: { type: 'string' },
          tag: { type: 'string' },
          search: { type: 'string' },
          dueBefore: { type: 'string', description: 'ISO date — invoices with dueDate <= this (use now() for overdue)' },
          sort: { type: 'string', enum: ['recent', 'total', 'number', 'due_date', 'amount_due'] },
          page: { type: 'number' },
          limit: { type: 'number' },
        },
      },
    },
    execute: async (args, companyId) => {
      const filters: ListInvoicesFilters = {
        status: args.status ? (String(args.status).split(',') as never) : undefined,
        contactId: args.contactId as string | undefined,
        dealId: args.dealId as string | undefined,
        tag: args.tag as string | undefined,
        search: args.search as string | undefined,
        dueBefore: args.dueBefore as string | undefined,
        sort: args.sort as ListInvoicesFilters['sort'],
        page: typeof args.page === 'number' ? args.page : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      };
      const { items, total } = await invoicesService.list(companyId, filters);
      if (items.length === 0) return 'No invoices match.';
      return `${items.length}/${total} invoices:\n` + items
        .map((inv) => {
          const due = inv.total - inv.amountPaid;
          return `- [${inv.status}] ${inv.invoiceNumber} · ${formatMinor(inv.total, inv.currency)}${due > 0 ? ` (due ${formatMinor(due, inv.currency)})` : ''}${inv.dueDate ? ' · due ' + new Date(inv.dueDate).toLocaleDateString() : ''} (id: ${inv.id})`;
        })
        .join('\n');
    },
  },
  {
    definition: {
      name: 'get_invoice',
      description: 'Get full invoice details including line items, totals, payment state, and recent activity.',
      parameters: { type: 'object', properties: { invoiceId: { type: 'string' } }, required: ['invoiceId'] },
    },
    execute: async (args, companyId) => {
      const inv = await invoicesService.get(companyId, args.invoiceId as string);
      return JSON.stringify({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        title: inv.title,
        status: inv.status,
        contactId: inv.contactId,
        dealId: inv.dealId,
        fromQuoteId: inv.fromQuoteId,
        currency: inv.currency,
        subtotal: inv.subtotal,
        tax: inv.tax,
        taxBps: inv.taxBps,
        discount: inv.discount,
        total: inv.total,
        amountPaid: inv.amountPaid,
        amountDue: inv.total - inv.amountPaid,
        totalFormatted: formatMinor(inv.total, inv.currency),
        amountPaidFormatted: formatMinor(inv.amountPaid, inv.currency),
        amountDueFormatted: formatMinor(inv.total - inv.amountPaid, inv.currency),
        dueDate: inv.dueDate,
        sentAt: inv.sentAt,
        viewedAt: inv.viewedAt,
        paidAt: inv.paidAt,
        lineItems: inv.lineItems.map((li) => ({
          id: li.id,
          name: li.name,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          discountBps: li.discountBps,
          total: li.total,
          totalFormatted: formatMinor(li.total, inv.currency),
        })),
        publicUrl: `/public/invoices/${inv.publicToken}`,
        recentActivity: inv.activities.map((a) => `[${a.createdAt.toISOString()}] ${a.type} — ${a.title}`),
      }, null, 2);
    },
  },
  {
    definition: {
      name: 'create_invoice',
      description: 'Create an invoice in DRAFT status. Money in minor units (50000 = ₹500.00). Pass initial lineItems OR call add_invoice_line_item afterwards. Number is auto-generated.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          dealId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          currency: { type: 'string', description: 'ISO code, default INR' },
          taxBps: { type: 'number', description: 'Tax percent in bps 0-10000 (1800 = 18%)' },
          discount: { type: 'number', description: 'Flat invoice-level discount in minor units' },
          dueDate: { type: 'string', description: 'ISO date' },
          notes: { type: 'string' },
          terms: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          lineItems: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                quantity: { type: 'number' },
                unitPrice: { type: 'number' },
                discountBps: { type: 'number' },
              },
              required: ['name'],
            },
          },
        },
      },
    },
    execute: async (args, companyId) => {
      const dto: CreateInvoiceDto = {
        contactId: args.contactId as string | undefined,
        dealId: args.dealId as string | undefined,
        title: args.title as string | undefined,
        description: args.description as string | undefined,
        currency: args.currency as string | undefined,
        taxBps: typeof args.taxBps === 'number' ? args.taxBps : undefined,
        discount: typeof args.discount === 'number' ? args.discount : undefined,
        dueDate: args.dueDate as string | undefined,
        notes: args.notes as string | undefined,
        terms: args.terms as string | undefined,
        tags: (args.tags as string[] | undefined) ?? undefined,
        lineItems: (args.lineItems as InvoiceLineItemInput[] | undefined) ?? [],
      };
      const inv = await invoicesService.create(companyId, AI_INVOICE_ACTOR, dto);
      return `Created invoice ${inv.invoiceNumber} (DRAFT) — total ${formatMinor(inv.total, inv.currency)}. id: ${inv.id}`;
    },
  },
  {
    definition: {
      name: 'update_invoice',
      description: 'Update invoice metadata (title, tax, discount, dueDate, etc.). Only works on DRAFT or SENT invoices.',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          contactId: { type: 'string' },
          dealId: { type: 'string' },
          taxBps: { type: 'number' },
          discount: { type: 'number' },
          currency: { type: 'string' },
          dueDate: { type: 'string' },
          notes: { type: 'string' },
          terms: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['invoiceId'],
      },
    },
    execute: async (args, companyId) => {
      const { invoiceId, ...rest } = args;
      const inv = await invoicesService.update(
        companyId,
        invoiceId as string,
        AI_INVOICE_ACTOR,
        rest as UpdateInvoiceDto,
      );
      return `Updated invoice ${inv.invoiceNumber} — total ${formatMinor(inv.total, inv.currency)}`;
    },
  },
  {
    definition: {
      name: 'add_invoice_line_item',
      description: 'Append a line item to a DRAFT or SENT invoice. Auto-recomputes totals.',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          quantity: { type: 'number' },
          unitPrice: { type: 'number', description: 'Minor units' },
          discountBps: { type: 'number', description: 'Per-line discount bps 0-10000' },
          productId: { type: 'string' },
        },
        required: ['invoiceId', 'name'],
      },
    },
    execute: async (args, companyId) => {
      const { invoiceId, ...item } = args;
      const inv = await invoicesService.addLineItem(
        companyId,
        invoiceId as string,
        AI_INVOICE_ACTOR,
        item as unknown as InvoiceLineItemInput,
      );
      return `Added "${item.name as string}" — new total ${formatMinor(inv.total, inv.currency)}`;
    },
  },
  {
    definition: {
      name: 'update_invoice_line_item',
      description: 'Update a line item on an invoice. Pass only changed fields.',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: { type: 'string' },
          lineItemId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          quantity: { type: 'number' },
          unitPrice: { type: 'number' },
          discountBps: { type: 'number' },
        },
        required: ['invoiceId', 'lineItemId'],
      },
    },
    execute: async (args, companyId) => {
      const { invoiceId, lineItemId, ...patch } = args;
      const inv = await invoicesService.updateLineItem(
        companyId,
        invoiceId as string,
        AI_INVOICE_ACTOR,
        lineItemId as string,
        patch as Partial<InvoiceLineItemInput>,
      );
      return `Updated line item — new total ${formatMinor(inv.total, inv.currency)}`;
    },
  },
  {
    definition: {
      name: 'remove_invoice_line_item',
      description: 'Remove a line item from an invoice.',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: { type: 'string' },
          lineItemId: { type: 'string' },
        },
        required: ['invoiceId', 'lineItemId'],
      },
    },
    execute: async (args, companyId) => {
      const inv = await invoicesService.removeLineItem(
        companyId,
        args.invoiceId as string,
        AI_INVOICE_ACTOR,
        args.lineItemId as string,
      );
      return `Removed line item — new total ${formatMinor(inv.total, inv.currency)}`;
    },
  },
  {
    definition: {
      name: 'send_invoice',
      description: 'Transition a DRAFT invoice to SENT. Share the public URL returned by get_invoice_public_url so the customer can view it.',
      parameters: { type: 'object', properties: { invoiceId: { type: 'string' } }, required: ['invoiceId'] },
    },
    execute: async (args, companyId) => {
      const inv = await invoicesService.send(companyId, args.invoiceId as string, AI_INVOICE_ACTOR);
      return `Sent ${inv.invoiceNumber}. Public URL path: /public/invoices/${inv.publicToken}`;
    },
  },
  {
    definition: {
      name: 'record_invoice_payment',
      description: 'Record a payment against an invoice. Amount is in minor units. Supports partial payments — the status auto-transitions to PARTIALLY_PAID or PAID based on the running total.',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: { type: 'string' },
          amount: { type: 'number', description: 'Payment amount in minor units (e.g. 30000 = ₹300.00)' },
          note: { type: 'string' },
          paymentId: { type: 'string', description: 'Optional — link to a Payment row' },
        },
        required: ['invoiceId', 'amount'],
      },
    },
    execute: async (args, companyId) => {
      const inv = await invoicesService.recordPayment(
        companyId,
        args.invoiceId as string,
        AI_INVOICE_ACTOR,
        args.amount as number,
        {
          paymentId: args.paymentId as string | undefined,
          note: args.note as string | undefined,
        },
      );
      const due = inv.total - inv.amountPaid;
      return `Recorded payment. Status: ${inv.status}. Paid ${formatMinor(inv.amountPaid, inv.currency)} of ${formatMinor(inv.total, inv.currency)}${due > 0 ? ` (${formatMinor(due, inv.currency)} outstanding)` : ' — fully paid!'}`;
    },
  },
  {
    definition: {
      name: 'mark_invoice_paid',
      description: 'Admin shortcut: mark a whole invoice as fully paid. Use when the payment came through a channel the CRM is not tracking automatically.',
      parameters: { type: 'object', properties: { invoiceId: { type: 'string' } }, required: ['invoiceId'] },
    },
    execute: async (args, companyId) => {
      const inv = await invoicesService.markPaid(companyId, args.invoiceId as string, AI_INVOICE_ACTOR);
      return `${inv.invoiceNumber} → PAID`;
    },
  },
  {
    definition: {
      name: 'mark_invoice_overdue',
      description: 'Flag a SENT/VIEWED/PARTIALLY_PAID invoice as OVERDUE (usually because the due date has passed).',
      parameters: { type: 'object', properties: { invoiceId: { type: 'string' } }, required: ['invoiceId'] },
    },
    execute: async (args, companyId) => {
      const inv = await invoicesService.markOverdue(companyId, args.invoiceId as string, AI_INVOICE_ACTOR);
      return `${inv.invoiceNumber} → OVERDUE`;
    },
  },
  {
    definition: {
      name: 'cancel_invoice',
      description: 'Cancel an invoice (cannot cancel a PAID or VOID one). Always pass a reason.',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['invoiceId'],
      },
    },
    execute: async (args, companyId) => {
      const inv = await invoicesService.cancel(
        companyId,
        args.invoiceId as string,
        AI_INVOICE_ACTOR,
        args.reason as string | undefined,
      );
      return `Cancelled ${inv.invoiceNumber}`;
    },
  },
  {
    definition: {
      name: 'void_invoice',
      description: 'Void an invoice — terminal, stronger than cancel. Use for billing errors / legal corrections. Always pass a reason.',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['invoiceId'],
      },
    },
    execute: async (args, companyId) => {
      const inv = await invoicesService.voidInvoice(
        companyId,
        args.invoiceId as string,
        AI_INVOICE_ACTOR,
        args.reason as string | undefined,
      );
      return `Voided ${inv.invoiceNumber}`;
    },
  },
  {
    definition: {
      name: 'duplicate_invoice',
      description: 'Clone an invoice as a new DRAFT with the same line items and terms. Useful for recurring billing.',
      parameters: { type: 'object', properties: { invoiceId: { type: 'string' } }, required: ['invoiceId'] },
    },
    execute: async (args, companyId) => {
      const inv = await invoicesService.duplicate(companyId, args.invoiceId as string, AI_INVOICE_ACTOR);
      return `Duplicated — new invoice ${inv.invoiceNumber} (DRAFT). id: ${inv.id}`;
    },
  },
  {
    definition: {
      name: 'add_invoice_note',
      description: 'Drop a note on the invoice timeline.',
      parameters: {
        type: 'object',
        properties: { invoiceId: { type: 'string' }, body: { type: 'string' } },
        required: ['invoiceId', 'body'],
      },
    },
    execute: async (args, companyId) => {
      await invoicesService.addNote(
        companyId,
        args.invoiceId as string,
        AI_INVOICE_ACTOR,
        args.body as string,
      );
      return `Note added`;
    },
  },
  {
    definition: {
      name: 'delete_invoice',
      description: 'Permanently delete an invoice. Only DRAFT, CANCELLED, or VOID can be deleted.',
      parameters: { type: 'object', properties: { invoiceId: { type: 'string' } }, required: ['invoiceId'] },
    },
    execute: async (args, companyId) => {
      await invoicesService.remove(companyId, args.invoiceId as string);
      return `Deleted`;
    },
  },
  {
    definition: {
      name: 'create_invoice_from_quote',
      description: 'Convert an ACCEPTED quote into a DRAFT invoice. Copies line items, totals, contact, deal, and terms. Sets fromQuoteId so the detail page deep-links back to the source.',
      parameters: { type: 'object', properties: { quoteId: { type: 'string' } }, required: ['quoteId'] },
    },
    execute: async (args, companyId) => {
      const inv = await invoicesService.createFromQuote(
        companyId,
        args.quoteId as string,
        AI_INVOICE_ACTOR,
      );
      return `Created invoice ${inv.invoiceNumber} from quote — total ${formatMinor(inv.total, inv.currency)}. id: ${inv.id}`;
    },
  },
  {
    definition: {
      name: 'get_invoice_stats',
      description: 'Aggregate invoice stats for the last N days — outstanding, overdue, collected, collection rate.',
      parameters: {
        type: 'object',
        properties: { days: { type: 'number', description: 'Lookback window. Default 30.' } },
      },
    },
    execute: async (args, companyId) => {
      const s = await invoicesService.stats(
        companyId,
        typeof args.days === 'number' ? args.days : 30,
      );
      return `Invoices (${s.rangeDays}d): ${s.totalInvoices} total\n` +
        `Outstanding: ${formatMinor(s.outstanding)} · Overdue: ${formatMinor(s.overdue)}\n` +
        `Collected: ${formatMinor(s.collected)} · Collection rate: ${s.collectionRate ?? 'n/a'}%\n` +
        `Average: ${s.averageTotal !== null ? formatMinor(s.averageTotal) : 'n/a'}\n` +
        `By status: ${Object.entries(s.byStatus).map(([k, v]) => `${k}=${v}`).join(' · ') || '(none)'}`;
    },
  },
  {
    definition: {
      name: 'get_invoice_timeline',
      description: 'Activity timeline for an invoice (most recent first).',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['invoiceId'],
      },
    },
    execute: async (args, companyId) => {
      const events = await invoicesService.getTimeline(
        companyId,
        args.invoiceId as string,
        typeof args.limit === 'number' ? args.limit : 30,
      );
      if (events.length === 0) return 'No activity.';
      return events
        .map((e) => `[${e.createdAt.toISOString()}] ${e.type} (${e.actorType}) — ${e.title}${e.body ? '\n  ' + e.body : ''}`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'get_invoice_public_url',
      description: 'Get the hosted public URL for an invoice — the link to share with the customer so they can view it.',
      parameters: { type: 'object', properties: { invoiceId: { type: 'string' } }, required: ['invoiceId'] },
    },
    execute: async (args, companyId) => {
      const inv = await invoicesService.get(companyId, args.invoiceId as string);
      if (inv.status === 'DRAFT') {
        return `MEMORY_SEARCH_UNAVAILABLE: invoice is still in DRAFT. Call send_invoice first.`;
      }
      const publicUrl = process.env.API_PUBLIC_URL?.replace(/\/$/, '');
      if (!publicUrl) {
        return `/public/invoices/${inv.publicToken} (API_PUBLIC_URL env var is not set — absolute URL not available; share the relative path)`;
      }
      return `${publicUrl}/public/invoices/${inv.publicToken}`;
    },
  },
  {
    definition: {
      name: 'bulk_send_invoices',
      description: 'Send multiple DRAFT invoices at once.',
      parameters: { type: 'object', properties: { invoiceIds: { type: 'array', items: { type: 'string' } } }, required: ['invoiceIds'] },
    },
    execute: async (args, companyId) => {
      const r = await invoicesService.bulkSend(
        companyId,
        args.invoiceIds as string[],
        AI_INVOICE_ACTOR,
      );
      return `Sent ${r.updated}, failed ${r.failed}.`;
    },
  },
  {
    definition: {
      name: 'bulk_cancel_invoices',
      description: 'Cancel multiple invoices at once.',
      parameters: {
        type: 'object',
        properties: {
          invoiceIds: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
        required: ['invoiceIds'],
      },
    },
    execute: async (args, companyId) => {
      const r = await invoicesService.bulkCancel(
        companyId,
        args.invoiceIds as string[],
        AI_INVOICE_ACTOR,
        args.reason as string | undefined,
      );
      return `Cancelled ${r.updated}, failed ${r.failed}.`;
    },
  },

  // ── Campaigns (full lifecycle — 24 tools) ─────────────────────────────────
  {
    definition: {
      name: 'list_campaigns',
      description: 'List campaigns with rich filters. Use this before answering any "show me my campaigns" question.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status (comma-separated for multiple): DRAFT, SCHEDULED, SENDING, PAUSED, COMPLETED, CANCELLED, FAILED' },
          channel: { type: 'string', description: 'WHATSAPP | EMAIL | SMS' },
          sendMode: { type: 'string', description: 'DIRECT | BROADCAST | SEQUENCE' },
          priority: { type: 'string', description: 'LOW | MEDIUM | HIGH | URGENT' },
          tag: { type: 'string', description: 'Filter by a specific tag' },
          search: { type: 'string', description: 'Free-text search over name/description/notes' },
          sort: { type: 'string', enum: ['recent', 'scheduled', 'name', 'progress'] },
          page: { type: 'number' },
          limit: { type: 'number' },
        },
      },
    },
    execute: async (args, companyId) => {
      const filters: ListCampaignsFilters = {
        status: args.status ? (String(args.status).split(',') as never) : undefined,
        channel: args.channel ? (String(args.channel).split(',') as never) : undefined,
        sendMode: args.sendMode ? (String(args.sendMode).split(',') as never) : undefined,
        priority: args.priority ? String(args.priority).split(',') : undefined,
        tag: args.tag as string | undefined,
        search: args.search as string | undefined,
        sort: args.sort as ListCampaignsFilters['sort'],
        page: typeof args.page === 'number' ? args.page : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      };
      const { items, total } = await campaignsService.list(companyId, filters);
      if (items.length === 0) return 'No campaigns match.';
      return `${items.length}/${total} campaigns:\n` + items
        .map((c) => `- [${c.status}] ${c.name} · ${c.channel}/${c.sendMode} · sent ${c.sentCount}/${c.totalRecipients}${c.startAt ? ' · starts ' + c.startAt.toISOString() : ''} (id: ${c.id})`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'get_campaign',
      description: 'Get full campaign details including the last 20 activity rows.',
      parameters: { type: 'object', properties: { campaignId: { type: 'string' } }, required: ['campaignId'] },
    },
    execute: async (args, companyId) => {
      const c = await campaignsService.get(companyId, args.campaignId as string);
      return JSON.stringify({
        id: c.id,
        name: c.name,
        status: c.status,
        channel: c.channel,
        sendMode: c.sendMode,
        templateId: c.templateId,
        sequenceId: c.sequenceId,
        startAt: c.startAt,
        startedAt: c.startedAt,
        completedAt: c.completedAt,
        audience: {
          tags: c.audienceTags,
          contactIds: c.audienceContactIds,
          optOutBehavior: c.audienceOptOutBehavior,
        },
        counters: {
          totalRecipients: c.totalRecipients,
          sent: c.sentCount,
          delivered: c.deliveredCount,
          read: c.readCount,
          replied: c.repliedCount,
          failed: c.failedCount,
          optedOut: c.optedOutCount,
        },
        recentActivity: c.activities.map((a) => `[${a.createdAt.toISOString()}] ${a.type} — ${a.title}`),
      }, null, 2);
    },
  },
  {
    definition: {
      name: 'create_campaign',
      description: 'Create a campaign in DRAFT status. After creation you usually want to call set_campaign_audience, set_campaign_template (for DIRECT mode), then schedule_campaign or launch_campaign.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          channel: { type: 'string', enum: ['WHATSAPP', 'EMAIL', 'SMS'], description: 'Default WHATSAPP — only WHATSAPP is fully wired in Phase 1.' },
          sendMode: { type: 'string', enum: ['DIRECT', 'BROADCAST', 'SEQUENCE'], description: 'DIRECT = rate-limited own sender. BROADCAST = dispatch via broadcast on launch. SEQUENCE = enrol audience into a sequence.' },
          templateId: { type: 'string', description: 'Template id — required for DIRECT sendMode. Use list_templates to find one.' },
          sequenceId: { type: 'string', description: 'Sequence id — required for SEQUENCE sendMode. Use list_sequences to find one.' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          tags: { type: 'array', items: { type: 'string' } },
          budget: { type: 'number' },
          throttleMs: { type: 'number', description: 'ms between DIRECT sends. Default 2000.' },
          notes: { type: 'string' },
          audienceTags: { type: 'array', items: { type: 'string' }, description: 'Contact tag filter — AND semantics.' },
          audienceContactIds: { type: 'array', items: { type: 'string' }, description: 'Explicit contact ids, merged with tag filter.' },
        },
        required: ['name'],
      },
    },
    execute: async (args, companyId) => {
      const dto: CreateCampaignDto = {
        name: args.name as string,
        description: args.description as string | undefined,
        channel: args.channel as CreateCampaignDto['channel'],
        sendMode: args.sendMode as CreateCampaignDto['sendMode'],
        templateId: args.templateId as string | undefined,
        sequenceId: args.sequenceId as string | undefined,
        priority: args.priority as CreateCampaignDto['priority'],
        tags: (args.tags as string[] | undefined) ?? undefined,
        budget: typeof args.budget === 'number' ? args.budget : undefined,
        throttleMs: typeof args.throttleMs === 'number' ? args.throttleMs : undefined,
        notes: args.notes as string | undefined,
        audience: {
          tags: (args.audienceTags as string[] | undefined) ?? [],
          contactIds: (args.audienceContactIds as string[] | undefined) ?? [],
          optOutBehavior: 'skip',
        },
      };
      const c = await campaignsService.create(companyId, AI_CAMPAIGN_ACTOR, dto);
      return `Created campaign "${c.name}" (${c.channel}/${c.sendMode}) in DRAFT status. id: ${c.id}`;
    },
  },
  {
    definition: {
      name: 'update_campaign',
      description: 'Update campaign fields. Only works on DRAFT or SCHEDULED campaigns — pause/cancel a SENDING one first.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          templateId: { type: 'string' },
          sequenceId: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          tags: { type: 'array', items: { type: 'string' } },
          throttleMs: { type: 'number' },
          notes: { type: 'string' },
        },
        required: ['campaignId'],
      },
    },
    execute: async (args, companyId) => {
      const { campaignId, ...rest } = args;
      const c = await campaignsService.update(
        companyId,
        campaignId as string,
        AI_CAMPAIGN_ACTOR,
        rest as UpdateCampaignDto,
      );
      return `Updated campaign "${c.name}"`;
    },
  },
  {
    definition: {
      name: 'set_campaign_audience',
      description: 'Set or replace the audience filter on a campaign. Call this before launching. Pass tags (AND-joined) OR explicit contactIds OR both.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Contact tag filter, AND semantics.' },
          contactIds: { type: 'array', items: { type: 'string' }, description: 'Explicit contact ids.' },
          optOutBehavior: { type: 'string', enum: ['skip', 'fail'], description: 'skip = silently drop opted-out contacts, fail = mark them OPTED_OUT in recipients.' },
        },
        required: ['campaignId'],
      },
    },
    execute: async (args, companyId) => {
      const filter: CampaignAudienceFilter = {
        tags: (args.tags as string[] | undefined) ?? [],
        contactIds: (args.contactIds as string[] | undefined) ?? [],
        optOutBehavior: (args.optOutBehavior as 'skip' | 'fail' | undefined) ?? 'skip',
      };
      const c = await campaignsService.setAudience(
        companyId,
        args.campaignId as string,
        AI_CAMPAIGN_ACTOR,
        filter,
      );
      return `Audience set: ${filter.tags?.length ?? 0} tags, ${filter.contactIds?.length ?? 0} explicit contacts. Campaign "${c.name}" is still in status ${c.status}.`;
    },
  },
  {
    definition: {
      name: 'preview_campaign_audience',
      description: 'Dry-run the audience filter and report how many contacts would receive this campaign, including opt-out counts. Use this before launching to validate targeting.',
      parameters: { type: 'object', properties: { campaignId: { type: 'string' } }, required: ['campaignId'] },
    },
    execute: async (args, companyId) => {
      const preview = await campaignsService.previewAudience(companyId, args.campaignId as string);
      const sample = preview.sampleContacts
        .map((c) => `  - ${c.displayName ?? c.phoneNumber} (${c.phoneNumber})`)
        .join('\n');
      return `${preview.netDeliverable} deliverable contacts (${preview.totalMatch} matched, ${preview.optedOut} opted out).\nFirst matches:\n${sample || '  (none)'}`;
    },
  },
  {
    definition: {
      name: 'schedule_campaign',
      description: 'Schedule a DRAFT campaign to start at a specific time. The minute-resolution worker tick will launch it automatically.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string' },
          startAt: { type: 'string', description: 'ISO-8601 timestamp.' },
        },
        required: ['campaignId', 'startAt'],
      },
    },
    execute: async (args, companyId) => {
      const c = await campaignsService.schedule(
        companyId,
        args.campaignId as string,
        AI_CAMPAIGN_ACTOR,
        args.startAt as string,
      );
      return `Campaign "${c.name}" scheduled for ${c.startAt?.toISOString()}.`;
    },
  },
  {
    definition: {
      name: 'launch_campaign',
      description: 'Launch a DRAFT or SCHEDULED campaign immediately. Resolves the audience, snapshots recipients, and flips the status to SENDING. Returns the resolved audience size.',
      parameters: { type: 'object', properties: { campaignId: { type: 'string' } }, required: ['campaignId'] },
    },
    execute: async (args, companyId) => {
      const { campaign, resolved } = await campaignsService.launch(
        companyId,
        args.campaignId as string,
        AI_CAMPAIGN_ACTOR,
      );
      return `Launched "${campaign.name}" — ${resolved.contactIds.length} recipients queued (${resolved.optedOutContactIds.length} opted out, ${resolved.totalMatch} total match). Status: ${campaign.status}.`;
    },
  },
  {
    definition: {
      name: 'pause_campaign',
      description: 'Pause a SENDING campaign. The send processor will stop draining recipients until resume_campaign is called.',
      parameters: { type: 'object', properties: { campaignId: { type: 'string' } }, required: ['campaignId'] },
    },
    execute: async (args, companyId) => {
      const c = await campaignsService.pause(companyId, args.campaignId as string, AI_CAMPAIGN_ACTOR);
      return `Paused "${c.name}".`;
    },
  },
  {
    definition: {
      name: 'resume_campaign',
      description: 'Resume a PAUSED campaign.',
      parameters: { type: 'object', properties: { campaignId: { type: 'string' } }, required: ['campaignId'] },
    },
    execute: async (args, companyId) => {
      const c = await campaignsService.resume(companyId, args.campaignId as string, AI_CAMPAIGN_ACTOR);
      return `Resumed "${c.name}".`;
    },
  },
  {
    definition: {
      name: 'cancel_campaign',
      description: 'Cancel a campaign (any non-terminal status). Pending recipients are marked SKIPPED. Always pass a reason.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['campaignId'],
      },
    },
    execute: async (args, companyId) => {
      const c = await campaignsService.cancel(
        companyId,
        args.campaignId as string,
        AI_CAMPAIGN_ACTOR,
        args.reason as string | undefined,
      );
      return `Cancelled "${c.name}".`;
    },
  },
  {
    definition: {
      name: 'duplicate_campaign',
      description: 'Clone a campaign as a new DRAFT with the same audience and template.',
      parameters: { type: 'object', properties: { campaignId: { type: 'string' } }, required: ['campaignId'] },
    },
    execute: async (args, companyId) => {
      const c = await campaignsService.duplicate(companyId, args.campaignId as string, AI_CAMPAIGN_ACTOR);
      return `Duplicated — new campaign id: ${c.id} (DRAFT status).`;
    },
  },
  {
    definition: {
      name: 'delete_campaign',
      description: 'Permanently delete a campaign. Only works on DRAFT, CANCELLED, or COMPLETED campaigns.',
      parameters: { type: 'object', properties: { campaignId: { type: 'string' } }, required: ['campaignId'] },
    },
    execute: async (args, companyId) => {
      await campaignsService.remove(companyId, args.campaignId as string);
      return `Deleted.`;
    },
  },
  {
    definition: {
      name: 'add_campaign_note',
      description: 'Drop a note on the campaign timeline. Use this after any manual status change or when the user tells you something worth preserving.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['campaignId', 'body'],
      },
    },
    execute: async (args, companyId) => {
      await campaignsService.addNote(
        companyId,
        args.campaignId as string,
        AI_CAMPAIGN_ACTOR,
        args.body as string,
      );
      return `Note added.`;
    },
  },
  {
    definition: {
      name: 'list_campaign_recipients',
      description: 'List recipients of a campaign with status filter. Useful for diagnosing why a campaign under-delivered.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string' },
          status: { type: 'string', description: 'Comma-separated: PENDING, QUEUED, SENT, DELIVERED, READ, REPLIED, FAILED, SKIPPED, OPTED_OUT' },
          page: { type: 'number' },
          limit: { type: 'number' },
        },
        required: ['campaignId'],
      },
    },
    execute: async (args, companyId) => {
      const { items, total } = await campaignsService.listRecipients(
        companyId,
        args.campaignId as string,
        {
          status: args.status ? (String(args.status).split(',') as never) : undefined,
          page: typeof args.page === 'number' ? args.page : undefined,
          limit: typeof args.limit === 'number' ? args.limit : undefined,
        },
      );
      if (items.length === 0) return 'No recipients match.';
      return `${items.length}/${total} recipients:\n` + items
        .map((r) => `- [${r.status}] contact ${r.contactId}${r.errorReason ? ' (error: ' + r.errorReason + ')' : ''}`)
        .slice(0, 30)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'get_campaign_stats',
      description: 'Get aggregate campaign stats across all campaigns created in the last N days.',
      parameters: {
        type: 'object',
        properties: { days: { type: 'number', description: 'Lookback window in days. Default 30.' } },
      },
    },
    execute: async (args, companyId) => {
      const s = await campaignsService.stats(
        companyId,
        typeof args.days === 'number' ? args.days : 30,
      );
      return `Campaigns (${s.rangeDays}d): ${s.totalCampaigns} total, ${s.activeCampaigns} active, ${s.scheduledCampaigns} scheduled, ${s.completedCampaigns} completed.\n` +
        `Sends: ${s.totalSent} sent, ${s.totalDelivered} delivered, ${s.totalReplied} replied, ${s.totalFailed} failed.\n` +
        `Reply rate: ${s.replyRate ?? 'n/a'}%  ·  Delivery rate: ${s.deliveryRate ?? 'n/a'}%`;
    },
  },
  {
    definition: {
      name: 'get_campaign_timeline',
      description: 'Fetch the activity timeline for a campaign (most recent first).',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['campaignId'],
      },
    },
    execute: async (args, companyId) => {
      const events = await campaignsService.getTimeline(
        companyId,
        args.campaignId as string,
        typeof args.limit === 'number' ? args.limit : 30,
      );
      if (events.length === 0) return 'No activity.';
      return events
        .map((e) => `[${e.createdAt.toISOString()}] ${e.type} (${e.actorType}) — ${e.title}${e.body ? '\n  ' + e.body : ''}`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'bulk_pause_campaigns',
      description: 'Pause multiple SENDING campaigns at once.',
      parameters: {
        type: 'object',
        properties: { campaignIds: { type: 'array', items: { type: 'string' } } },
        required: ['campaignIds'],
      },
    },
    execute: async (args, companyId) => {
      const r = await campaignsService.bulkPause(
        companyId,
        args.campaignIds as string[],
        AI_CAMPAIGN_ACTOR,
      );
      return `Paused ${r.updated}, failed ${r.failed}.${r.failed > 0 ? ' Errors: ' + r.errors.map((e) => `${e.id}: ${e.reason}`).join('; ') : ''}`;
    },
  },
  {
    definition: {
      name: 'bulk_resume_campaigns',
      description: 'Resume multiple PAUSED campaigns at once.',
      parameters: {
        type: 'object',
        properties: { campaignIds: { type: 'array', items: { type: 'string' } } },
        required: ['campaignIds'],
      },
    },
    execute: async (args, companyId) => {
      const r = await campaignsService.bulkResume(
        companyId,
        args.campaignIds as string[],
        AI_CAMPAIGN_ACTOR,
      );
      return `Resumed ${r.updated}, failed ${r.failed}.`;
    },
  },
  {
    definition: {
      name: 'bulk_cancel_campaigns',
      description: 'Cancel multiple campaigns at once.',
      parameters: {
        type: 'object',
        properties: {
          campaignIds: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
        required: ['campaignIds'],
      },
    },
    execute: async (args, companyId) => {
      const r = await campaignsService.bulkCancel(
        companyId,
        args.campaignIds as string[],
        AI_CAMPAIGN_ACTOR,
        args.reason as string | undefined,
      );
      return `Cancelled ${r.updated}, failed ${r.failed}.`;
    },
  },
  {
    definition: {
      name: 'bulk_delete_campaigns',
      description: 'Permanently delete multiple campaigns. Only DRAFT/CANCELLED/COMPLETED ones will actually be deleted.',
      parameters: {
        type: 'object',
        properties: { campaignIds: { type: 'array', items: { type: 'string' } } },
        required: ['campaignIds'],
      },
    },
    execute: async (args, companyId) => {
      const r = await campaignsService.bulkDelete(companyId, args.campaignIds as string[]);
      return `Deleted ${r.updated}, failed ${r.failed}.`;
    },
  },
  {
    definition: {
      name: 'set_campaign_template',
      description: 'Swap the template used by a DIRECT-mode campaign for rendering recipient bodies.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string' },
          templateId: { type: 'string' },
        },
        required: ['campaignId', 'templateId'],
      },
    },
    execute: async (args, companyId) => {
      const c = await campaignsService.update(
        companyId,
        args.campaignId as string,
        AI_CAMPAIGN_ACTOR,
        { templateId: args.templateId as string },
      );
      return `Template set on "${c.name}".`;
    },
  },
  {
    definition: {
      name: 'attach_campaign_to_sequence',
      description: 'Switch a campaign to SEQUENCE send mode and link it to an existing sequence.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string' },
          sequenceId: { type: 'string' },
        },
        required: ['campaignId', 'sequenceId'],
      },
    },
    execute: async (args, companyId) => {
      const c = await campaignsService.update(
        companyId,
        args.campaignId as string,
        AI_CAMPAIGN_ACTOR,
        { sendMode: 'SEQUENCE', sequenceId: args.sequenceId as string },
      );
      return `Campaign "${c.name}" will enrol its audience into sequence ${args.sequenceId as string} on launch.`;
    },
  },
  {
    definition: {
      name: 'attach_campaign_to_broadcast',
      description: 'Switch a campaign to BROADCAST send mode. On launch, the campaign dispatches a Broadcast for one-shot bulk delivery.',
      parameters: { type: 'object', properties: { campaignId: { type: 'string' } }, required: ['campaignId'] },
    },
    execute: async (args, companyId) => {
      const c = await campaignsService.update(
        companyId,
        args.campaignId as string,
        AI_CAMPAIGN_ACTOR,
        { sendMode: 'BROADCAST' },
      );
      return `Campaign "${c.name}" switched to BROADCAST send mode.`;
    },
  },

  // ── Forms (full lifecycle — 22 tools) ─────────────────────────────────────
  {
    definition: {
      name: 'list_forms',
      description: 'List forms with rich filters. Use this before answering any "show me my forms" question.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Comma-separated: DRAFT, ACTIVE, PAUSED, ARCHIVED' },
          tag: { type: 'string' },
          search: { type: 'string', description: 'Free-text over name, description, notes' },
          sort: { type: 'string', enum: ['recent', 'name', 'submissions', 'conversion'] },
          page: { type: 'number' },
          limit: { type: 'number' },
        },
      },
    },
    execute: async (args, companyId) => {
      const filters: ListFormsFilters = {
        status: args.status ? (String(args.status).split(',') as never) : undefined,
        tag: args.tag as string | undefined,
        search: args.search as string | undefined,
        sort: args.sort as ListFormsFilters['sort'],
        page: typeof args.page === 'number' ? args.page : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      };
      const { items, total } = await formsService.list(companyId, filters);
      if (items.length === 0) return 'No forms match.';
      return `${items.length}/${total} forms:\n` + items
        .map((f) => `- [${f.status}] ${f.name} (slug: ${f.slug}) · ${f.submitCount} submits · ${f.convertedCount} converted · id: ${f.id}`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'get_form',
      description: 'Get full form details including fields, auto-actions, and recent activity.',
      parameters: { type: 'object', properties: { formId: { type: 'string' } }, required: ['formId'] },
    },
    execute: async (args, companyId) => {
      const f = await formsService.get(companyId, args.formId as string);
      return JSON.stringify({
        id: f.id,
        name: f.name,
        slug: f.slug,
        status: f.status,
        description: f.description,
        fields: f.fields,
        isPublic: f.isPublic,
        rateLimitPerHour: f.rateLimitPerHour,
        autoActions: {
          autoCreateLead: f.autoCreateLead,
          autoLeadSource: f.autoLeadSource,
          autoLeadTitle: f.autoLeadTitle,
          autoEnrollSequenceId: f.autoEnrollSequenceId,
          autoAssignUserId: f.autoAssignUserId,
          autoTagContact: f.autoTagContact,
        },
        counters: {
          submitCount: f.submitCount,
          convertedCount: f.convertedCount,
          spamCount: f.spamCount,
        },
        webhookForwardUrl: f.webhookForwardUrl,
        recentActivity: f.activities.map((a) => `[${a.createdAt.toISOString()}] ${a.type} — ${a.title}`),
      }, null, 2);
    },
  },
  {
    definition: {
      name: 'create_form',
      description: 'Create a form in DRAFT status. After creation you usually want to call add_form_field multiple times, then set_form_auto_actions, then publish_form.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          tags: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
          initialFields: {
            type: 'array',
            description: 'Optional list of fields to create immediately with the form. Same shape as add_form_field.',
            items: { type: 'object' },
          },
        },
        required: ['name'],
      },
    },
    execute: async (args, companyId) => {
      const dto: CreateFormDto = {
        name: args.name as string,
        description: args.description as string | undefined,
        priority: args.priority as CreateFormDto['priority'],
        tags: (args.tags as string[] | undefined) ?? undefined,
        notes: args.notes as string | undefined,
        fields: (args.initialFields as FormField[] | undefined) ?? [],
      };
      const f = await formsService.create(companyId, AI_FORM_ACTOR, dto);
      return `Created form "${f.name}" (slug: ${f.slug}) in DRAFT. id: ${f.id}`;
    },
  },
  {
    definition: {
      name: 'update_form',
      description: 'Update form metadata (name, description, tags, public settings). Only works on DRAFT/ACTIVE/PAUSED forms.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
          isPublic: { type: 'boolean', description: 'Whether to expose the form on the /public/forms/:slug URL' },
          rateLimitPerHour: { type: 'number' },
          requireCaptcha: { type: 'boolean' },
        },
        required: ['formId'],
      },
    },
    execute: async (args, companyId) => {
      const { formId, ...rest } = args;
      const f = await formsService.update(
        companyId,
        formId as string,
        AI_FORM_ACTOR,
        rest as UpdateFormDto,
      );
      return `Updated form "${f.name}"`;
    },
  },
  {
    definition: {
      name: 'add_form_field',
      description: 'Append a typed field to a form. Supported types: text, email, phone, number, textarea, select, radio, checkbox, date, url. For select/radio, pass `options` as an array of {value, label}.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          key: { type: 'string', description: 'Stable identifier used in submission payloads. Must match [a-zA-Z_][a-zA-Z0-9_-]*.' },
          type: { type: 'string', enum: ['text', 'email', 'phone', 'number', 'textarea', 'select', 'radio', 'checkbox', 'date', 'url'] },
          label: { type: 'string' },
          placeholder: { type: 'string' },
          description: { type: 'string' },
          required: { type: 'boolean' },
          options: {
            type: 'array',
            description: 'For select/radio types.',
            items: {
              type: 'object',
              properties: { value: { type: 'string' }, label: { type: 'string' } },
              required: ['value', 'label'],
            },
          },
          minLength: { type: 'number' },
          maxLength: { type: 'number' },
        },
        required: ['formId', 'key', 'type', 'label'],
      },
    },
    execute: async (args, companyId) => {
      const { formId, ...fieldArgs } = args;
      const f = await formsService.addField(
        companyId,
        formId as string,
        AI_FORM_ACTOR,
        fieldArgs as unknown as FormField,
      );
      return `Added field "${(fieldArgs as { label: string }).label}" to "${f.name}"`;
    },
  },
  {
    definition: {
      name: 'remove_form_field',
      description: 'Remove a field from a form by its key.',
      parameters: {
        type: 'object',
        properties: { formId: { type: 'string' }, key: { type: 'string' } },
        required: ['formId', 'key'],
      },
    },
    execute: async (args, companyId) => {
      const f = await formsService.removeField(
        companyId,
        args.formId as string,
        AI_FORM_ACTOR,
        args.key as string,
      );
      return `Removed field from "${f.name}"`;
    },
  },
  {
    definition: {
      name: 'reorder_form_fields',
      description: 'Reorder the fields of a form. Pass the full array of field keys in the desired order.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          keys: { type: 'array', items: { type: 'string' } },
        },
        required: ['formId', 'keys'],
      },
    },
    execute: async (args, companyId) => {
      await formsService.reorderFields(
        companyId,
        args.formId as string,
        AI_FORM_ACTOR,
        args.keys as string[],
      );
      return `Fields reordered`;
    },
  },
  {
    definition: {
      name: 'set_form_auto_actions',
      description: 'Configure what happens automatically when someone submits a form. Typically: auto-create a Lead with a source, tag the contact, assign to a user. All fields optional.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          autoCreateLead: { type: 'boolean' },
          autoLeadSource: { type: 'string', description: 'Lead source enum: WHATSAPP, WEBSITE, REFERRAL, FORM, META_ADS, WEBHOOK, OTHER, etc.' },
          autoLeadTitle: { type: 'string', description: 'Template string; supports {{fieldKey}} tokens from the submission' },
          autoEnrollSequenceId: { type: 'string', description: 'Sequence to enrol the auto-created lead into' },
          autoAssignUserId: { type: 'string' },
          autoTagContact: { type: 'array', items: { type: 'string' } },
          webhookForwardUrl: { type: 'string', description: 'POST every raw submission to this URL (best-effort)' },
        },
        required: ['formId'],
      },
    },
    execute: async (args, companyId) => {
      const { formId, ...cfg } = args;
      await formsService.setAutoActions(
        companyId,
        formId as string,
        AI_FORM_ACTOR,
        cfg as AutoActionsConfig,
      );
      return `Auto-actions updated`;
    },
  },
  {
    definition: {
      name: 'publish_form',
      description: 'Publish a DRAFT or PAUSED form so it starts accepting submissions. Requires at least one field.',
      parameters: { type: 'object', properties: { formId: { type: 'string' } }, required: ['formId'] },
    },
    execute: async (args, companyId) => {
      const f = await formsService.publish(companyId, args.formId as string, AI_FORM_ACTOR);
      return `Published "${f.name}" at slug "${f.slug}"`;
    },
  },
  {
    definition: {
      name: 'unpublish_form',
      description: 'Pause an ACTIVE form so it stops accepting new submissions.',
      parameters: { type: 'object', properties: { formId: { type: 'string' } }, required: ['formId'] },
    },
    execute: async (args, companyId) => {
      const f = await formsService.unpublish(companyId, args.formId as string, AI_FORM_ACTOR);
      return `Unpublished "${f.name}"`;
    },
  },
  {
    definition: {
      name: 'archive_form',
      description: 'Archive a form. Archived forms can be restored via restore_form.',
      parameters: { type: 'object', properties: { formId: { type: 'string' } }, required: ['formId'] },
    },
    execute: async (args, companyId) => {
      const f = await formsService.archive(companyId, args.formId as string, AI_FORM_ACTOR);
      return `Archived "${f.name}"`;
    },
  },
  {
    definition: {
      name: 'duplicate_form',
      description: 'Duplicate a form as a new DRAFT with the same fields and auto-actions.',
      parameters: { type: 'object', properties: { formId: { type: 'string' } }, required: ['formId'] },
    },
    execute: async (args, companyId) => {
      const f = await formsService.duplicate(companyId, args.formId as string, AI_FORM_ACTOR);
      return `Duplicated — new form id: ${f.id} (DRAFT)`;
    },
  },
  {
    definition: {
      name: 'delete_form',
      description: 'Permanently delete a form. Only DRAFT or ARCHIVED forms can be deleted.',
      parameters: { type: 'object', properties: { formId: { type: 'string' } }, required: ['formId'] },
    },
    execute: async (args, companyId) => {
      await formsService.remove(companyId, args.formId as string);
      return `Deleted`;
    },
  },
  {
    definition: {
      name: 'add_form_note',
      description: 'Drop a note on the form timeline.',
      parameters: {
        type: 'object',
        properties: { formId: { type: 'string' }, body: { type: 'string' } },
        required: ['formId', 'body'],
      },
    },
    execute: async (args, companyId) => {
      await formsService.addNote(
        companyId,
        args.formId as string,
        AI_FORM_ACTOR,
        args.body as string,
      );
      return `Note added`;
    },
  },
  {
    definition: {
      name: 'list_form_submissions',
      description: 'List submissions for a form with optional status filter. Use status=RECEIVED,SPAM,CONVERTED to diagnose deliverability.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          status: { type: 'string', description: 'Comma-separated: RECEIVED, PROCESSED, CONVERTED, SPAM, ARCHIVED' },
          page: { type: 'number' },
          limit: { type: 'number' },
        },
        required: ['formId'],
      },
    },
    execute: async (args, companyId) => {
      const { items, total } = await formsService.listSubmissions(
        companyId,
        args.formId as string,
        {
          status: args.status ? (String(args.status).split(',') as never) : undefined,
          page: typeof args.page === 'number' ? args.page : undefined,
          limit: typeof args.limit === 'number' ? args.limit : undefined,
        },
      );
      if (items.length === 0) return 'No submissions match.';
      return `${items.length}/${total} submissions:\n` + items
        .slice(0, 30)
        .map((s) => `- [${s.status}] ${s.id} (${new Date(s.createdAt).toLocaleString()}${s.leadId ? ' → lead ' + s.leadId : ''})`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'get_form_submission',
      description: 'Get full details of a single form submission, including the raw payload.',
      parameters: {
        type: 'object',
        properties: { formId: { type: 'string' }, submissionId: { type: 'string' } },
        required: ['formId', 'submissionId'],
      },
    },
    execute: async (args, companyId) => {
      const s = await formsService.getSubmission(
        companyId,
        args.formId as string,
        args.submissionId as string,
      );
      return JSON.stringify(s, null, 2);
    },
  },
  {
    definition: {
      name: 'convert_submission_to_lead',
      description: 'Manually convert a form submission to a Lead (if auto-create was off, or to create a second lead).',
      parameters: {
        type: 'object',
        properties: {
          submissionId: { type: 'string' },
          title: { type: 'string', description: 'Optional lead title override' },
          source: { type: 'string', description: 'Optional LeadSource override' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['submissionId'],
      },
    },
    execute: async (args, companyId) => {
      const { submissionId, ...overrides } = args;
      const r = await formsService.convertSubmissionToLead(
        companyId,
        submissionId as string,
        AI_FORM_ACTOR,
        overrides as never,
      );
      return `Converted submission → lead ${r.leadId}${r.contactId ? ' (contact ' + r.contactId + ')' : ''}`;
    },
  },
  {
    definition: {
      name: 'mark_submission_spam',
      description: 'Mark a form submission as spam — bumps the form spam counter and excludes it from stats.',
      parameters: {
        type: 'object',
        properties: { submissionId: { type: 'string' } },
        required: ['submissionId'],
      },
    },
    execute: async (args, companyId) => {
      await formsService.markSubmissionSpam(
        companyId,
        args.submissionId as string,
        AI_FORM_ACTOR,
      );
      return `Marked as spam`;
    },
  },
  {
    definition: {
      name: 'delete_form_submission',
      description: 'Permanently delete a form submission.',
      parameters: {
        type: 'object',
        properties: { submissionId: { type: 'string' } },
        required: ['submissionId'],
      },
    },
    execute: async (args, companyId) => {
      await formsService.deleteSubmission(companyId, args.submissionId as string);
      return `Deleted`;
    },
  },
  {
    definition: {
      name: 'get_form_stats',
      description: 'Get aggregate form stats across all forms created in the last N days.',
      parameters: {
        type: 'object',
        properties: { days: { type: 'number', description: 'Lookback window in days. Default 30.' } },
      },
    },
    execute: async (args, companyId) => {
      const s = await formsService.stats(
        companyId,
        typeof args.days === 'number' ? args.days : 30,
      );
      return `Forms (${s.rangeDays}d): ${s.totalForms} total, ${s.activeForms} active.\n` +
        `Submissions: ${s.totalSubmissions} total, ${s.totalConverted} converted, ${s.totalSpam} spam.\n` +
        `Conversion rate: ${s.conversionRate ?? 'n/a'}%  ·  Spam rate: ${s.spamRate ?? 'n/a'}%`;
    },
  },
  {
    definition: {
      name: 'get_form_timeline',
      description: 'Fetch the activity timeline for a form (most recent first).',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['formId'],
      },
    },
    execute: async (args, companyId) => {
      const events = await formsService.getTimeline(
        companyId,
        args.formId as string,
        typeof args.limit === 'number' ? args.limit : 30,
      );
      if (events.length === 0) return 'No activity.';
      return events
        .map((e) => `[${e.createdAt.toISOString()}] ${e.type} (${e.actorType}) — ${e.title}${e.body ? '\n  ' + e.body : ''}`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'get_form_public_url',
      description: 'Get the hosted public URL for a form. Returns the URL when the form is ACTIVE, isPublic, and the CRM has an API_PUBLIC_URL configured; otherwise returns an explanation of what is blocking it.',
      parameters: { type: 'object', properties: { formId: { type: 'string' } }, required: ['formId'] },
    },
    execute: async (args, companyId) => {
      const f = await formsService.get(companyId, args.formId as string);
      const blockers: string[] = [];
      if (f.status !== 'ACTIVE') blockers.push(`status is ${f.status}, must be ACTIVE`);
      if (!f.isPublic) blockers.push('isPublic=false — flip it via update_form');
      const publicUrl = process.env.API_PUBLIC_URL?.replace(/\/$/, '');
      if (!publicUrl) blockers.push('API_PUBLIC_URL env var is not set — Meta/public hosting not configured');
      if (blockers.length > 0) {
        return `MEMORY_SEARCH_UNAVAILABLE: form is not publicly reachable.\nBlockers:\n${blockers.map((b) => '  - ' + b).join('\n')}`;
      }
      return `${publicUrl}/public/forms/${f.slug}`;
    },
  },
  {
    definition: {
      name: 'bulk_publish_forms',
      description: 'Publish multiple DRAFT/PAUSED forms at once.',
      parameters: { type: 'object', properties: { formIds: { type: 'array', items: { type: 'string' } } }, required: ['formIds'] },
    },
    execute: async (args, companyId) => {
      const r = await formsService.bulkPublish(
        companyId,
        args.formIds as string[],
        AI_FORM_ACTOR,
      );
      return `Published ${r.updated}, failed ${r.failed}.`;
    },
  },
  {
    definition: {
      name: 'bulk_archive_forms',
      description: 'Archive multiple forms at once.',
      parameters: { type: 'object', properties: { formIds: { type: 'array', items: { type: 'string' } } }, required: ['formIds'] },
    },
    execute: async (args, companyId) => {
      const r = await formsService.bulkArchive(
        companyId,
        args.formIds as string[],
        AI_FORM_ACTOR,
      );
      return `Archived ${r.updated}, failed ${r.failed}.`;
    },
  },

  // ── Workflows ─────────────────────────────────────────────────────────────
  {
    definition: { name: 'create_workflow', description: 'Create an automation workflow with trigger and steps.', parameters: { type: 'object', properties: { name: { type: 'string' }, trigger: { type: 'object', description: 'e.g. {type: "contact_created"}' }, steps: { type: 'array', items: { type: 'object' }, description: 'e.g. [{type: "send_message", config: {text: "Welcome!"}}]' } }, required: ['name'] } },
    execute: async (args, companyId) => {
      const w = await prisma.workflow.create({ data: { companyId, name: args.name as string, trigger: (args.trigger || {}) as any, steps: (args.steps || []) as any } });
      return `Created workflow "${w.name}" — activate it to start running`;
    },
  },
  {
    definition: { name: 'list_workflows', description: 'List automation workflows.', parameters: { type: 'object', properties: {}, required: [] } },
    execute: async (_args, companyId) => {
      const wfs = await prisma.workflow.findMany({ where: { companyId }, take: 20 });
      if (!wfs.length) return 'No workflows found';
      return wfs.map((w) => `- "${w.name}" | ${w.isActive ? 'Active' : 'Inactive'} | Runs: ${w.runCount}`).join('\n');
    },
  },
  {
    definition: { name: 'toggle_workflow', description: 'Enable or disable a workflow.', parameters: { type: 'object', properties: { workflowId: { type: 'string' }, active: { type: 'boolean' } }, required: ['workflowId', 'active'] } },
    execute: async (args, _companyId) => {
      const w = await prisma.workflow.update({ where: { id: args.workflowId as string }, data: { isActive: args.active as boolean } });
      return `Workflow "${w.name}" is now ${w.isActive ? 'active' : 'inactive'}`;
    },
  },

  // ── Tickets (full lifecycle — 20 tools) ───────────────────────────────────
  {
    definition: {
      name: 'list_tickets',
      description: 'List support tickets with rich filters.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Comma-separated: OPEN, IN_PROGRESS, WAITING, ESCALATED, RESOLVED, CLOSED' },
          priority: { type: 'string', description: 'Comma-separated: LOW, MEDIUM, HIGH, CRITICAL' },
          assignedToId: { type: 'string', description: 'Pass "null" for unassigned' },
          contactId: { type: 'string' },
          category: { type: 'string' },
          tag: { type: 'string' },
          search: { type: 'string' },
          slaBreached: { type: 'boolean', description: 'Only tickets with SLA breaches' },
          sort: { type: 'string', enum: ['recent', 'priority', 'updated', 'oldest'] },
          page: { type: 'number' },
          limit: { type: 'number' },
        },
      },
    },
    execute: async (args, companyId) => {
      const filters: ListTicketsFilters = {
        status: args.status ? (String(args.status).split(',') as never) : undefined,
        priority: args.priority ? (String(args.priority).split(',') as never) : undefined,
        assignedToId: args.assignedToId === 'null' ? null : args.assignedToId as string | undefined,
        contactId: args.contactId as string | undefined,
        category: args.category as string | undefined,
        tag: args.tag as string | undefined,
        search: args.search as string | undefined,
        slaBreached: args.slaBreached as boolean | undefined,
        sort: args.sort as ListTicketsFilters['sort'],
        page: typeof args.page === 'number' ? args.page : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      };
      const { items, total } = await ticketsService.list(companyId, filters);
      if (items.length === 0) return 'No tickets match.';
      return `${items.length}/${total} tickets:\n` + items
        .map((t) => `- [${t.status}/${t.priority}] ${t.ticketNumber} "${t.title}" · ${t.category ?? 'general'}${t.assignedToId ? ' → assigned' : ' (unassigned)'}${t.slaFirstResponseBreached || t.slaResolutionBreached ? ' ⚠ SLA BREACHED' : ''} (id: ${t.id})`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'get_ticket',
      description: 'Get full ticket details including comments, SLA status, and recent activity.',
      parameters: { type: 'object', properties: { ticketId: { type: 'string' } }, required: ['ticketId'] },
    },
    execute: async (args, companyId) => {
      const t = await ticketsService.get(companyId, args.ticketId as string);
      return JSON.stringify({
        id: t.id,
        ticketNumber: t.ticketNumber,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        category: t.category,
        source: t.source,
        contactId: t.contactId,
        assignedToId: t.assignedToId,
        tags: t.tags,
        sla: {
          policyId: t.slaPolicyId,
          firstResponseDue: t.slaFirstResponseDue,
          resolutionDue: t.slaResolutionDue,
          firstResponseBreached: t.slaFirstResponseBreached,
          resolutionBreached: t.slaResolutionBreached,
          firstResponseAt: t.firstResponseAt,
        },
        resolvedAt: t.resolvedAt,
        closedAt: t.closedAt,
        escalatedAt: t.escalatedAt,
        mergedIntoId: t.mergedIntoId,
        commentCount: t.comments.length,
        recentActivity: t.activities.map((a) => `[${a.createdAt.toISOString()}] ${a.type} — ${a.title}`),
      }, null, 2);
    },
  },
  {
    definition: {
      name: 'create_ticket',
      description: 'Create a support ticket. Optionally link to a contact and assign to an agent.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
          category: { type: 'string', description: 'bug, feature, billing, general, etc.' },
          source: { type: 'string', enum: ['WHATSAPP', 'EMAIL', 'WEB', 'MANUAL', 'AI_CHAT', 'FORM'] },
          contactId: { type: 'string' },
          assignedToId: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
          slaPolicyId: { type: 'string', description: 'SLA policy to apply (optional)' },
        },
        required: ['title'],
      },
    },
    execute: async (args, companyId) => {
      const dto: CreateTicketDto = {
        title: args.title as string,
        description: args.description as string | undefined,
        priority: args.priority as CreateTicketDto['priority'],
        category: args.category as string | undefined,
        source: args.source as CreateTicketDto['source'],
        contactId: args.contactId as string | undefined,
        assignedToId: args.assignedToId as string | undefined,
        tags: (args.tags as string[] | undefined) ?? undefined,
        notes: args.notes as string | undefined,
        slaPolicyId: args.slaPolicyId as string | undefined,
      };
      const t = await ticketsService.create(companyId, AI_TICKET_ACTOR, dto);
      return `Created ticket ${t.ticketNumber} — "${t.title}" [${t.priority}/${t.status}]. id: ${t.id}`;
    },
  },
  {
    definition: {
      name: 'update_ticket',
      description: 'Update ticket fields (title, description, priority, category, tags). Use change_ticket_status for status changes and assign_ticket for assignment.',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
          category: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
        required: ['ticketId'],
      },
    },
    execute: async (args, companyId) => {
      const { ticketId, ...rest } = args;
      const t = await ticketsService.update(
        companyId,
        ticketId as string,
        AI_TICKET_ACTOR,
        rest as UpdateTicketDto,
      );
      return `Updated ticket "${t.title}" — [${t.priority}]`;
    },
  },
  {
    definition: {
      name: 'change_ticket_status',
      description: 'Change the status of a ticket. Valid transitions: OPEN, IN_PROGRESS, WAITING, ESCALATED, RESOLVED, CLOSED. Reopening a RESOLVED/CLOSED ticket sets it back to OPEN.',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          status: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'WAITING', 'ESCALATED', 'RESOLVED', 'CLOSED'] },
          reason: { type: 'string' },
        },
        required: ['ticketId', 'status'],
      },
    },
    execute: async (args, companyId) => {
      const t = await ticketsService.changeStatus(
        companyId,
        args.ticketId as string,
        AI_TICKET_ACTOR,
        args.status as never,
        args.reason as string | undefined,
      );
      return `Ticket "${t.title}" → ${t.status}`;
    },
  },
  {
    definition: {
      name: 'assign_ticket',
      description: 'Assign a ticket to an agent (userId) or unassign (pass null). Also stamps first-response if this is the first assignment.',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          assignedToId: { type: 'string', description: 'User id, or null to unassign' },
        },
        required: ['ticketId', 'assignedToId'],
      },
    },
    execute: async (args, companyId) => {
      const assignedTo = args.assignedToId === 'null' ? null : args.assignedToId as string;
      const t = await ticketsService.assign(
        companyId,
        args.ticketId as string,
        AI_TICKET_ACTOR,
        assignedTo,
      );
      return assignedTo
        ? `Assigned ticket "${t.title}" to ${assignedTo}`
        : `Unassigned ticket "${t.title}"`;
    },
  },
  {
    definition: {
      name: 'escalate_ticket',
      description: 'Escalate a ticket — changes status to ESCALATED. Always pass a reason.',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['ticketId'],
      },
    },
    execute: async (args, companyId) => {
      const t = await ticketsService.escalate(
        companyId,
        args.ticketId as string,
        AI_TICKET_ACTOR,
        args.reason as string | undefined,
      );
      return `Escalated ticket "${t.title}"`;
    },
  },
  {
    definition: {
      name: 'add_ticket_comment',
      description: 'Add a comment to a ticket. Set isInternal=true for internal notes not visible to the customer.',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          content: { type: 'string' },
          isInternal: { type: 'boolean', description: 'Internal note (default false)' },
        },
        required: ['ticketId', 'content'],
      },
    },
    execute: async (args, companyId) => {
      await ticketsService.addComment(
        companyId,
        args.ticketId as string,
        AI_TICKET_ACTOR,
        args.content as string,
        (args.isInternal as boolean) ?? false,
      );
      return `Comment added`;
    },
  },
  {
    definition: {
      name: 'list_ticket_comments',
      description: 'List all comments on a ticket (oldest first).',
      parameters: { type: 'object', properties: { ticketId: { type: 'string' } }, required: ['ticketId'] },
    },
    execute: async (args, companyId) => {
      const comments = await ticketsService.listComments(companyId, args.ticketId as string);
      if (comments.length === 0) return 'No comments.';
      return comments
        .map((c) => `[${c.createdAt.toISOString()}] (${c.authorType}${c.isInternal ? ', INTERNAL' : ''}) ${c.content.slice(0, 200)}`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'merge_tickets',
      description: 'Merge a source ticket into a target ticket. Comments move to the target; source is closed with a mergedIntoId reference.',
      parameters: {
        type: 'object',
        properties: {
          sourceTicketId: { type: 'string' },
          targetTicketId: { type: 'string' },
        },
        required: ['sourceTicketId', 'targetTicketId'],
      },
    },
    execute: async (args, companyId) => {
      const t = await ticketsService.merge(
        companyId,
        args.sourceTicketId as string,
        args.targetTicketId as string,
        AI_TICKET_ACTOR,
      );
      return `Merged ${t.ticketNumber} into ${args.targetTicketId as string}`;
    },
  },
  {
    definition: {
      name: 'add_ticket_note',
      description: 'Drop a note on the ticket timeline (not a comment — just an activity entry).',
      parameters: {
        type: 'object',
        properties: { ticketId: { type: 'string' }, body: { type: 'string' } },
        required: ['ticketId', 'body'],
      },
    },
    execute: async (args, companyId) => {
      await ticketsService.addNote(
        companyId,
        args.ticketId as string,
        AI_TICKET_ACTOR,
        args.body as string,
      );
      return `Note added`;
    },
  },
  {
    definition: {
      name: 'delete_ticket',
      description: 'Permanently delete a ticket. Only CLOSED tickets can be deleted.',
      parameters: { type: 'object', properties: { ticketId: { type: 'string' } }, required: ['ticketId'] },
    },
    execute: async (args, companyId) => {
      await ticketsService.remove(companyId, args.ticketId as string);
      return `Deleted`;
    },
  },
  {
    definition: {
      name: 'get_ticket_stats',
      description: 'Aggregate ticket stats — open count, resolved count, avg first response time, avg resolution time, SLA breach count.',
      parameters: {
        type: 'object',
        properties: { days: { type: 'number', description: 'Lookback window. Default 30.' } },
      },
    },
    execute: async (args, companyId) => {
      const s = await ticketsService.stats(
        companyId,
        typeof args.days === 'number' ? args.days : 30,
      );
      return `Tickets (${s.rangeDays}d): ${s.totalTickets} total · ${s.openTickets} open · ${s.resolvedTickets} resolved\n` +
        `Avg first response: ${s.avgFirstResponseMins !== null ? s.avgFirstResponseMins + ' min' : 'n/a'}\n` +
        `Avg resolution: ${s.avgResolutionMins !== null ? s.avgResolutionMins + ' min' : 'n/a'}\n` +
        `SLA breaches: ${s.slaBreachCount}\n` +
        `By status: ${Object.entries(s.byStatus).map(([k, v]) => `${k}=${v}`).join(' · ') || '(none)'}\n` +
        `By priority: ${Object.entries(s.byPriority).map(([k, v]) => `${k}=${v}`).join(' · ') || '(none)'}`;
    },
  },
  {
    definition: {
      name: 'get_ticket_timeline',
      description: 'Fetch the activity timeline for a ticket (most recent first).',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['ticketId'],
      },
    },
    execute: async (args, companyId) => {
      const events = await ticketsService.getTimeline(
        companyId,
        args.ticketId as string,
        typeof args.limit === 'number' ? args.limit : 30,
      );
      if (events.length === 0) return 'No activity.';
      return events
        .map((e) => `[${e.createdAt.toISOString()}] ${e.type} (${e.actorType}) — ${e.title}${e.body ? '\n  ' + e.body : ''}`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'bulk_assign_tickets',
      description: 'Assign multiple tickets to the same agent.',
      parameters: {
        type: 'object',
        properties: {
          ticketIds: { type: 'array', items: { type: 'string' } },
          assignedToId: { type: 'string' },
        },
        required: ['ticketIds', 'assignedToId'],
      },
    },
    execute: async (args, companyId) => {
      const r = await ticketsService.bulkAssign(
        companyId,
        args.ticketIds as string[],
        AI_TICKET_ACTOR,
        args.assignedToId as string,
      );
      return `Assigned ${r.updated}, failed ${r.failed}.`;
    },
  },
  {
    definition: {
      name: 'bulk_close_tickets',
      description: 'Close multiple tickets at once.',
      parameters: {
        type: 'object',
        properties: { ticketIds: { type: 'array', items: { type: 'string' } } },
        required: ['ticketIds'],
      },
    },
    execute: async (args, companyId) => {
      const r = await ticketsService.bulkClose(
        companyId,
        args.ticketIds as string[],
        AI_TICKET_ACTOR,
      );
      return `Closed ${r.updated}, failed ${r.failed}.`;
    },
  },
  {
    definition: {
      name: 'bulk_delete_tickets',
      description: 'Permanently delete multiple closed tickets.',
      parameters: {
        type: 'object',
        properties: { ticketIds: { type: 'array', items: { type: 'string' } } },
        required: ['ticketIds'],
      },
    },
    execute: async (args, companyId) => {
      const r = await ticketsService.bulkDelete(companyId, args.ticketIds as string[]);
      return `Deleted ${r.updated}, failed ${r.failed}.`;
    },
  },

  // ── Knowledge Base ────────────────────────────────────────────────────────
  {
    definition: { name: 'create_kb_article', description: 'Create a knowledge base article.', parameters: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, category: { type: 'string' } }, required: ['title', 'content'] } },
    execute: async (args, companyId) => {
      const a = await prisma.knowledgeBaseArticle.create({ data: { companyId, title: args.title as string, content: args.content as string, category: (args.category as string) || undefined } });
      return `Created KB article "${a.title}"`;
    },
  },
  {
    definition: { name: 'search_knowledge_base', description: 'Search knowledge base articles.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    execute: async (args, companyId) => {
      const articles = await prisma.knowledgeBaseArticle.findMany({
        where: { companyId, OR: [{ title: { contains: args.query as string, mode: 'insensitive' as const } }, { content: { contains: args.query as string, mode: 'insensitive' as const } }] },
        take: 5,
      });
      if (!articles.length) return 'No articles found';
      return articles.map((a) => `- "${a.title}" [${a.category || 'general'}]: ${a.content.slice(0, 100)}...`).join('\n');
    },
  },

  // ── Reports ───────────────────────────────────────────────────────────────
  {
    definition: { name: 'generate_report', description: 'Generate a quick report on an entity.', parameters: { type: 'object', properties: { entity: { type: 'string', enum: ['contacts', 'leads', 'deals', 'tickets', 'payments'] } }, required: ['entity'] } },
    execute: async (args, companyId) => {
      const entity = args.entity as string;
      switch (entity) {
        case 'contacts': { const c = await prisma.contact.count({ where: { companyId, deletedAt: null } }); return `Total contacts: ${c}`; }
        case 'leads': {
          const all = await prisma.lead.groupBy({ by: ['status'], where: { companyId }, _count: true });
          return `Leads:\n${all.map((g) => `  ${g.status}: ${g._count}`).join('\n')}`;
        }
        case 'deals': {
          const all = await prisma.deal.groupBy({ by: ['stage'], where: { companyId }, _count: true, _sum: { value: true } });
          return `Deals:\n${all.map((g) => `  ${g.stage}: ${g._count} deals, ₹${(g._sum?.value ?? 0)}`).join('\n')}`;
        }
        case 'tickets': {
          const all = await prisma.ticket.groupBy({ by: ['status'], where: { companyId }, _count: true });
          return `Tickets:\n${all.map((g) => `  ${g.status}: ${g._count}`).join('\n')}`;
        }
        case 'payments': {
          const all = await prisma.payment.groupBy({ by: ['status'], where: { companyId }, _count: true, _sum: { amount: true } });
          return `Payments:\n${all.map((g) => `  ${g.status}: ${g._count}, ₹${(g._sum?.amount ?? 0) / 100}`).join('\n')}`;
        }
        default: return 'Unknown entity';
      }
    },
  },

  // ── Calendar ──────────────────────────────────────────────────────────────
  {
    definition: { name: 'create_calendar_event', description: 'Create a calendar event/meeting.', parameters: { type: 'object', properties: { title: { type: 'string' }, startAt: { type: 'string', description: 'ISO date' }, endAt: { type: 'string', description: 'ISO date' }, contactId: { type: 'string' }, location: { type: 'string' } }, required: ['title', 'startAt', 'endAt'] } },
    execute: async (args, companyId) => {
      const e = await prisma.calendarEvent.create({ data: { companyId, title: args.title as string, startAt: new Date(args.startAt as string), endAt: new Date(args.endAt as string), contactId: (args.contactId as string) || undefined, location: (args.location as string) || undefined } });
      return `Created event "${e.title}" on ${e.startAt.toISOString().split('T')[0]}`;
    },
  },

  // ── Documents ─────────────────────────────────────────────────────────────
  {
    definition: { name: 'list_documents', description: 'List documents.', parameters: { type: 'object', properties: { contactId: { type: 'string' } }, required: [] } },
    execute: async (args, companyId) => {
      const where: Record<string, unknown> = { companyId };
      if (args.contactId) where.contactId = args.contactId;
      const docs = await prisma.document.findMany({ where: where as any, take: 20, orderBy: { createdAt: 'desc' } });
      if (!docs.length) return 'No documents found';
      return docs.map((d) => `- "${d.name}" [${d.type}] — ${d.createdAt.toISOString().split('T')[0]}`).join('\n');
    },
  },

  // ── Memory (OpenClaw-style: file-based markdown + hybrid vector/FTS) ──────
  {
    definition: {
      name: 'memory_search',
      description: 'Mandatory recall step: semantically search memory files before answering questions about prior work, decisions, dates, people, preferences, or todos. Always call this first when the user asks anything about themselves, their business, or past context.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural-language query to search memory for' },
          maxResults: { type: 'number', description: 'How many results to return (default 10, max 50)' },
          minScore: { type: 'number', description: 'Drop hits below this score (0-1)' },
        },
        required: ['query'],
      },
    },
    execute: async (args, companyId) => {
      const result = await memoryService.searchWithStatus(companyId, args.query as string, {
        maxResults: typeof args.maxResults === 'number' ? args.maxResults : 10,
        minScore: typeof args.minScore === 'number' ? args.minScore : undefined,
      });
      if (result.unavailable) {
        // Distinct from "no hits" — the AI should explain to the user that
        // memory search is broken instead of asserting absence.
        return `MEMORY_SEARCH_UNAVAILABLE: ${result.unavailable.reason}. Tell the user you couldn't search memory; do NOT assert that the requested fact does not exist.`;
      }
      if (result.hits.length === 0) {
        // Soft empty — the AI may still have the answer in MEMORY.md (which is
        // implicitly available through memory_get). Suggest that path instead
        // of refusing.
        return 'No matching chunks. If you suspect the fact may exist in MEMORY.md, call `memory_get` with path="MEMORY.md" to read it directly before answering.';
      }
      return result.hits
        .map(
          (h, i) =>
            `${i + 1}. [score=${h.score.toFixed(3)}] ${h.path}:${h.startLine}-${h.endLine}\n${h.text.slice(0, 300)}`,
        )
        .join('\n\n');
    },
  },
  {
    definition: {
      name: 'memory_get',
      description: 'Read specific lines from a memory file. Use after memory_search to fetch the exact passage you need (cite path + line range).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path returned by memory_search (e.g. "MEMORY.md")' },
          from: { type: 'number', description: '1-based line to start reading from (optional, defaults to start)' },
          lines: { type: 'number', description: 'Number of lines to read (optional, defaults to whole file)' },
        },
        required: ['path'],
      },
    },
    execute: async (args, companyId) => {
      const content = await memoryService.readFile(
        companyId,
        args.path as string,
        typeof args.from === 'number' ? args.from : undefined,
        typeof args.lines === 'number' ? args.lines : undefined,
      );
      if (content === null) return `Memory file not found: ${args.path as string}`;
      return content || '(empty file)';
    },
  },
  {
    definition: {
      name: 'memory_write',
      description: 'Append a fact to long-term memory (MEMORY.md). Use proactively when the user shares anything worth persisting across all future conversations: their name, role, interests, business policies, prices, hours, decisions, etc. Save silently — do not ask permission.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short section heading (e.g. "User Interests", "Pricing")' },
          content: { type: 'string', description: 'The fact to remember, in 1-3 sentences' },
        },
        required: ['title', 'content'],
      },
    },
    execute: async (args, companyId) => {
      await memoryService.appendToMemoryDoc(
        companyId,
        args.title as string,
        args.content as string,
      );
      return `Saved to MEMORY.md: ${args.title as string}`;
    },
  },
  {
    definition: {
      name: 'memory_list_files',
      description: 'List all memory files for this workspace, including session transcripts and ad-hoc memory files.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    execute: async (_args, companyId) => {
      const files = await memoryService.listFiles(companyId);
      if (!files.length) return 'No memory files yet.';
      return files
        .map((f) => `- ${f.path} (${f.source}, ${f.size} bytes, updated ${f.updatedAt.toISOString().slice(0, 10)})`)
        .join('\n');
    },
  },
];

// ── Core tools (sent to AI to avoid token overflow) ─────────────────────────
// AI can still execute ANY tool if it knows the name, but we only TELL it about
// the most useful ~20 tools to avoid overwhelming the context.

const CORE_TOOL_NAMES = new Set([
  // Memory (priority — for context retention)
  'memory_search', 'memory_get', 'memory_write', 'memory_list_files',
  // Contacts
  'create_contact', 'update_contact', 'delete_contact', 'search_contacts', 'get_contact',
  'tag_contact', 'add_contact_note', 'get_contact_timeline',
  // Leads (full lifecycle — see admin-tools.ts for the additional ~14 callable-by-name tools)
  'list_leads', 'get_lead', 'create_lead', 'update_lead',
  'qualify_lead', 'convert_lead_to_deal', 'add_lead_note', 'assign_lead',
  // Deals (full lifecycle — see admin-tools.ts for the additional ~14 callable-by-name tools)
  'list_deals', 'get_deal', 'create_deal', 'update_deal',
  'move_deal_stage', 'add_deal_note', 'assign_deal', 'get_deal_forecast',
  // Tasks (full lifecycle — see admin-tools.ts for the additional ~14 callable-by-name tools)
  'list_tasks', 'get_task', 'create_task', 'update_task',
  'mark_task_done', 'add_task_comment', 'assign_task', 'reschedule_task',
  // Products (full catalog — see admin-tools.ts for the additional ~12 callable-by-name tools)
  'list_products', 'get_product', 'create_product', 'update_product',
  'adjust_product_stock', 'list_low_stock_products',
  // Broadcasts (full lifecycle — see admin-tools.ts for the additional ~12 callable-by-name tools)
  'list_broadcasts', 'get_broadcast', 'create_broadcast', 'set_broadcast_audience',
  'preview_audience_size', 'schedule_broadcast', 'send_broadcast_now',
  // Templates (full lifecycle — see admin-tools.ts for the additional ~12 callable-by-name tools)
  'list_templates', 'get_template', 'create_template', 'update_template',
  'activate_template', 'archive_template', 'preview_template', 'send_template',
  // Sequences (full lifecycle — see admin-tools.ts for the additional ~26 callable-by-name tools)
  'list_sequences', 'get_sequence', 'create_sequence', 'update_sequence',
  'activate_sequence', 'pause_sequence', 'add_sequence_step', 'enroll_contact_in_sequence',
  // Campaigns (full lifecycle — 24 tools total, 7 exposed by default)
  'list_campaigns', 'get_campaign', 'create_campaign', 'set_campaign_audience',
  'schedule_campaign', 'launch_campaign', 'get_campaign_stats',
  // Forms (full lifecycle — 24 tools total, 8 exposed by default)
  'list_forms', 'get_form', 'create_form', 'add_form_field',
  'set_form_auto_actions', 'publish_form', 'list_form_submissions', 'get_form_stats',
  // Quotes (full lifecycle — 22 tools total, 7 exposed by default)
  'list_quotes', 'get_quote', 'create_quote', 'add_quote_line_item',
  'send_quote', 'accept_quote', 'get_quote_stats',
  // Invoices (full lifecycle — 22 tools total, 8 exposed by default)
  'list_invoices', 'get_invoice', 'create_invoice', 'add_invoice_line_item',
  'send_invoice', 'record_invoice_payment', 'create_invoice_from_quote', 'get_invoice_stats',
  // Payments (full lifecycle — 18 tools total, 7 exposed by default)
  'list_payments', 'get_payment', 'create_payment_link', 'record_manual_payment',
  'refund_payment', 'get_payment_stats', 'list_payments_for_invoice',
  // Communication
  'send_whatsapp', 'list_conversations',
  // Analytics
  'get_analytics',
  // Tickets (full lifecycle — 20 tools total, 8 exposed by default)
  'list_tickets', 'get_ticket', 'create_ticket', 'change_ticket_status',
  'assign_ticket', 'escalate_ticket', 'add_ticket_comment', 'get_ticket_stats',
]);

// ── Exports ─────────────────────────────────────────────────────────────────

export function getAdminToolDefinitions(): ToolDefinition[] {
  // Only send core tools to AI to prevent token overflow
  return tools
    .filter((t) => CORE_TOOL_NAMES.has(t.definition.name))
    .map((t) => t.definition);
}

/**
 * Categorize a tool by its name. Used to render the docs page
 * (apps/dashboard/src/app/(dashboard)/docs/page.tsx) in grouped sections.
 *
 * The order of the rules matters — the first match wins. Add new rules near
 * the top when you introduce a new tool prefix.
 */
function categorizeTool(name: string): string {
  const m = (re: RegExp) => re.test(name);
  if (m(/^memory_/)) return 'Memory';
  if (m(/^send_whatsapp|^list_conversations/)) return 'WhatsApp & Messaging';
  if (m(/^create_broadcast|^list_broadcasts|^send_broadcast/)) return 'Broadcasts';
  if (m(/^get_analytics|^get_lead_stats/)) return 'Analytics';
  if (m(/contact/)) return 'Contacts';
  if (m(/lead/)) return 'Leads';
  if (m(/deal/)) return 'Deals';
  if (m(/task/)) return 'Tasks';
  if (m(/template/)) return 'Templates';
  if (m(/sequence/)) return 'Sequences';
  if (m(/pipeline/)) return 'Pipelines';
  if (m(/product/)) return 'Products';
  if (m(/quote/)) return 'Quotes';
  if (m(/invoice/)) return 'Invoices';
  if (m(/payment/)) return 'Payments';
  if (m(/campaign/)) return 'Campaigns';
  if (m(/form/)) return 'Forms';
  if (m(/workflow/)) return 'Workflows';
  if (m(/ticket/)) return 'Tickets';
  if (m(/knowledge_base|^kb_|knowledgebase/i)) return 'Knowledge Base';
  if (m(/report/)) return 'Reports';
  if (m(/calendar|event/)) return 'Calendar';
  if (m(/document/)) return 'Documents';
  return 'Other';
}

export interface CatalogEntry {
  name: string;
  description: string;
  category: string;
  /** Whether this tool is in the always-sent CORE_TOOL_NAMES whitelist. */
  core: boolean;
  parameters: Record<string, unknown>;
}

/**
 * Returns every tool the AI can call (not just the CORE whitelist) with a
 * category attached, ready to be rendered as a docs page or pulled into a
 * GUI tool palette.
 */
export function getAdminToolCatalog(): CatalogEntry[] {
  return tools.map((t) => ({
    name: t.definition.name,
    description: t.definition.description,
    category: categorizeTool(t.definition.name),
    core: CORE_TOOL_NAMES.has(t.definition.name),
    parameters: t.definition.parameters,
  }));
}

export async function executeAdminTool(
  name: string,
  args: Record<string, unknown>,
  companyId: string,
  context: ToolContext = {},
): Promise<string> {
  const tool = tools.find((t) => t.definition.name === name);
  if (!tool) return `Unknown tool: ${name}`;
  try {
    return await tool.execute(args, companyId, context);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Tool error: ${msg}`;
  }
}
