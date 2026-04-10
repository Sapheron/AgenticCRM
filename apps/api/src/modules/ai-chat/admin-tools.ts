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

  // ── Payments ──────────────────────────────────────────────────────────────
  {
    definition: {
      name: 'list_payments',
      description: 'List payment records.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED', 'EXPIRED'] },
          limit: { type: 'number' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      const where: Record<string, unknown> = { companyId };
      if (args.status) where.status = args.status;
      const payments = await prisma.payment.findMany({ where: where as any, take: (args.limit as number) || 10, orderBy: { createdAt: 'desc' } });
      if (!payments.length) return 'No payments found';
      return payments.map((p) => `- ₹${p.amount / 100} | ${p.status} | ${p.description || 'no desc'} | ${p.createdAt.toISOString().split('T')[0]}`).join('\n');
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

  // ── Quotes ────────────────────────────────────────────────────────────────
  {
    definition: { name: 'create_quote', description: 'Create a quote with line items.', parameters: { type: 'object', properties: { contactId: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, quantity: { type: 'number' }, unitPrice: { type: 'number' } } } }, notes: { type: 'string' } }, required: ['items'] } },
    execute: async (args, companyId) => {
      const items = (args.items as Array<{ name: string; quantity?: number; unitPrice: number }>) || [];
      const total = items.reduce((s, i) => s + (i.quantity || 1) * i.unitPrice, 0);
      const q = await prisma.quote.create({
        data: {
          companyId, contactId: (args.contactId as string) || undefined,
          quoteNumber: `Q-${Date.now().toString(36).toUpperCase()}`,
          subtotal: total, total, notes: (args.notes as string) || undefined,
          lineItems: { create: items.map((i) => ({ name: i.name, quantity: i.quantity || 1, unitPrice: i.unitPrice, total: (i.quantity || 1) * i.unitPrice })) },
        },
      });
      return `Created quote ${q.quoteNumber} — ₹${total / 100} (${items.length} items)`;
    },
  },

  // ── Invoices ──────────────────────────────────────────────────────────────
  {
    definition: { name: 'create_invoice', description: 'Create an invoice.', parameters: { type: 'object', properties: { contactId: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, quantity: { type: 'number' }, unitPrice: { type: 'number' } } } }, dueDate: { type: 'string' } }, required: ['items'] } },
    execute: async (args, companyId) => {
      const items = (args.items as Array<{ name: string; quantity?: number; unitPrice: number }>) || [];
      const total = items.reduce((s, i) => s + (i.quantity || 1) * i.unitPrice, 0);
      const inv = await prisma.invoice.create({
        data: {
          companyId, contactId: (args.contactId as string) || undefined,
          invoiceNumber: `INV-${Date.now().toString(36).toUpperCase()}`,
          subtotal: total, total, dueDate: args.dueDate ? new Date(args.dueDate as string) : undefined,
          lineItems: { create: items.map((i) => ({ name: i.name, quantity: i.quantity || 1, unitPrice: i.unitPrice, total: (i.quantity || 1) * i.unitPrice })) },
        },
      });
      return `Created invoice ${inv.invoiceNumber} — ₹${total / 100}`;
    },
  },

  // ── Campaigns ─────────────────────────────────────────────────────────────
  {
    definition: { name: 'create_campaign', description: 'Create a marketing campaign.', parameters: { type: 'object', properties: { name: { type: 'string' }, channel: { type: 'string', enum: ['whatsapp', 'email', 'sms'] }, segmentId: { type: 'string' }, budget: { type: 'number' } }, required: ['name'] } },
    execute: async (args, companyId) => {
      const c = await prisma.campaign.create({ data: { companyId, name: args.name as string, channel: (args.channel as string) || 'whatsapp', segmentId: (args.segmentId as string) || undefined, budget: (args.budget as number) || undefined } });
      return `Created campaign "${c.name}" on ${c.channel}`;
    },
  },
  {
    definition: { name: 'get_campaign_stats', description: 'Get stats for a campaign.', parameters: { type: 'object', properties: { campaignId: { type: 'string' } }, required: ['campaignId'] } },
    execute: async (args, _companyId) => {
      const c = await prisma.campaign.findUnique({ where: { id: args.campaignId as string } });
      if (!c) return 'Campaign not found';
      return `Campaign "${c.name}" — Status: ${c.status}, Sent: ${c.sentCount}, Replies: ${c.replyCount}, Conversions: ${c.convertedCount}`;
    },
  },

  // ── Forms ─────────────────────────────────────────────────────────────────
  {
    definition: { name: 'create_form', description: 'Create a web form for lead capture.', parameters: { type: 'object', properties: { name: { type: 'string' }, fields: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' }, label: { type: 'string' }, required: { type: 'boolean' } } } } }, required: ['name', 'fields'] } },
    execute: async (args, companyId) => {
      const f = await prisma.form.create({ data: { companyId, name: args.name as string, fields: args.fields as any } });
      return `Created form "${f.name}" with ${(args.fields as unknown[]).length} fields`;
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

  // ── Tickets ───────────────────────────────────────────────────────────────
  {
    definition: { name: 'create_ticket', description: 'Create a support ticket.', parameters: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] }, category: { type: 'string' }, contactId: { type: 'string' } }, required: ['title'] } },
    execute: async (args, companyId) => {
      const t = await prisma.ticket.create({ data: { companyId, title: args.title as string, description: (args.description as string) || undefined, priority: (args.priority as string) || 'MEDIUM', category: (args.category as string) || undefined, contactId: (args.contactId as string) || undefined } });
      return `Created ticket #${t.id.slice(-6)} — "${t.title}" [${t.priority}]`;
    },
  },
  {
    definition: { name: 'update_ticket', description: 'Update ticket status, priority, or assignee.', parameters: { type: 'object', properties: { ticketId: { type: 'string' }, status: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'] }, priority: { type: 'string' }, assignedToId: { type: 'string' } }, required: ['ticketId'] } },
    execute: async (args, _companyId) => {
      const data: Record<string, unknown> = {};
      if (args.status) { data.status = args.status; if (args.status === 'RESOLVED') data.resolvedAt = new Date(); if (args.status === 'CLOSED') data.closedAt = new Date(); }
      if (args.priority) data.priority = args.priority;
      if (args.assignedToId) data.assignedToId = args.assignedToId;
      const t = await prisma.ticket.update({ where: { id: args.ticketId as string }, data });
      return `Updated ticket "${t.title}" — status: ${t.status}, priority: ${t.priority}`;
    },
  },
  {
    definition: { name: 'list_tickets', description: 'List support tickets.', parameters: { type: 'object', properties: { status: { type: 'string' }, priority: { type: 'string' } }, required: [] } },
    execute: async (args, companyId) => {
      const where: Record<string, unknown> = { companyId };
      if (args.status) where.status = args.status;
      if (args.priority) where.priority = args.priority;
      const tickets = await prisma.ticket.findMany({ where: where as any, take: 20, orderBy: { createdAt: 'desc' } });
      if (!tickets.length) return 'No tickets found';
      return tickets.map((t) => `- #${t.id.slice(-6)} "${t.title}" | ${t.status} | ${t.priority} | ${t.category || 'general'}`).join('\n');
    },
  },
  {
    definition: { name: 'add_ticket_comment', description: 'Add a comment to a ticket.', parameters: { type: 'object', properties: { ticketId: { type: 'string' }, content: { type: 'string' }, isInternal: { type: 'boolean', description: 'Internal note (not visible to customer)' } }, required: ['ticketId', 'content'] } },
    execute: async (args, _companyId) => {
      await prisma.ticketComment.create({ data: { ticketId: args.ticketId as string, content: args.content as string, isInternal: (args.isInternal as boolean) ?? false } });
      return `Comment added to ticket`;
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
      const hits = await memoryService.search(companyId, args.query as string, {
        maxResults: typeof args.maxResults === 'number' ? args.maxResults : 10,
        minScore: typeof args.minScore === 'number' ? args.minScore : undefined,
      });
      if (hits.length === 0) return 'No memory hits.';
      return hits
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
  // Communication
  'send_whatsapp', 'list_conversations',
  // Analytics
  'get_analytics',
  // Tickets
  'create_ticket', 'list_tickets',
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
