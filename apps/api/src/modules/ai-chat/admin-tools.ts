/**
 * Admin CRM Tools — AI can control the entire CRM via these tools.
 * Each tool has: name, description, parameters (JSON Schema), execute function.
 */
import { prisma } from '@wacrm/database';
import Redis from 'ioredis';
import { MemoryService } from '../memory/memory.service';

// Memory service is a plain class (no DI deps), so we can instantiate it once
// here and reuse across tool calls. Tools that don't go through Nest's DI
// container (like the chat tools) need this.
const memoryService = new MemoryService();

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

type ToolExecutor = (args: Record<string, unknown>, companyId: string) => Promise<string>;

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

  // ── Leads ─────────────────────────────────────────────────────────────────
  {
    definition: {
      name: 'create_lead',
      description: 'Create a new sales lead.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Lead title (e.g., "Website Redesign for Acme")' },
          contactId: { type: 'string', description: 'Contact ID to link' },
          phoneNumber: { type: 'string', description: 'Contact phone (if no contactId)' },
          estimatedValue: { type: 'number', description: 'Estimated deal value' },
          source: { type: 'string', description: 'Lead source (e.g., whatsapp, website, referral)' },
        },
        required: ['title'],
      },
    },
    execute: async (args, companyId) => {
      let contactId = args.contactId as string;
      if (!contactId && args.phoneNumber) {
        const c = await prisma.contact.findFirst({ where: { companyId, phoneNumber: args.phoneNumber as string } });
        if (c) contactId = c.id;
      }
      const lead = await prisma.lead.create({
        data: {
          company: { connect: { id: companyId } },
          title: args.title as string,
          ...(contactId ? { contact: { connect: { id: contactId } } } : {}),
          estimatedValue: (args.estimatedValue as number) || undefined,
          source: (args.source as string) || 'ai_chat',
          status: 'NEW',
        } as any,
      });
      return `Created lead: "${lead.title}" (ID: ${lead.id}, status: NEW)`;
    },
  },
  {
    definition: {
      name: 'update_lead',
      description: 'Update a lead status, value, or notes.',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string', description: 'Lead ID' },
          status: { type: 'string', enum: ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'NEGOTIATING', 'WON', 'LOST', 'DISQUALIFIED'] },
          estimatedValue: { type: 'number' },
          notes: { type: 'string' },
        },
        required: ['leadId'],
      },
    },
    execute: async (args, _companyId) => {
      const data: Record<string, unknown> = {};
      if (args.status) data.status = args.status;
      if (args.estimatedValue) data.estimatedValue = args.estimatedValue;
      if (args.notes) data.notes = args.notes;
      if (args.status === 'WON') data.wonAt = new Date();
      if (args.status === 'LOST') data.lostAt = new Date();
      const lead = await prisma.lead.update({ where: { id: args.leadId as string }, data });
      return `Updated lead "${lead.title}" — status: ${lead.status}`;
    },
  },
  {
    definition: {
      name: 'list_leads',
      description: 'List leads with optional status filter.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      const where: Record<string, unknown> = { companyId };
      if (args.status) where.status = args.status;
      const leads = await prisma.lead.findMany({ where: where as any, take: (args.limit as number) || 10, orderBy: { createdAt: 'desc' }, include: { contact: { select: { displayName: true, phoneNumber: true } } } });
      if (!leads.length) return 'No leads found';
      return leads.map((l) => `- "${l.title}" | ${l.status} | ₹${l.estimatedValue || 0} | ${l.contact?.displayName || l.contact?.phoneNumber || 'no contact'} | ID: ${l.id}`).join('\n');
    },
  },

  // ── Deals ─────────────────────────────────────────────────────────────────
  {
    definition: {
      name: 'create_deal',
      description: 'Create a new deal in the pipeline.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Deal title' },
          value: { type: 'number', description: 'Deal value' },
          contactId: { type: 'string' },
          phoneNumber: { type: 'string', description: 'Contact phone (if no contactId)' },
          stage: { type: 'string', enum: ['LEAD_IN', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] },
        },
        required: ['title'],
      },
    },
    execute: async (args, companyId) => {
      let contactId = args.contactId as string;
      if (!contactId && args.phoneNumber) {
        const c = await prisma.contact.findFirst({ where: { companyId, phoneNumber: args.phoneNumber as string } });
        if (c) contactId = c.id;
      }
      const deal = await prisma.deal.create({
        data: {
          company: { connect: { id: companyId } },
          title: args.title as string,
          value: (args.value as number) || 0,
          ...(contactId ? { contact: { connect: { id: contactId } } } : {}),
          stage: ((args.stage as string) || 'LEAD_IN') as any,
          probability: (args.stage as string) === 'WON' ? 100 : 20,
        } as any,
      });
      return `Created deal: "${deal.title}" | Stage: ${deal.stage} | Value: ₹${deal.value} | ID: ${deal.id}`;
    },
  },
  {
    definition: {
      name: 'update_deal',
      description: 'Update a deal stage, value, or notes.',
      parameters: {
        type: 'object',
        properties: {
          dealId: { type: 'string', description: 'Deal ID' },
          stage: { type: 'string', enum: ['LEAD_IN', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] },
          value: { type: 'number' },
          notes: { type: 'string' },
        },
        required: ['dealId'],
      },
    },
    execute: async (args, _companyId) => {
      const data: Record<string, unknown> = {};
      if (args.stage) {
        data.stage = args.stage;
        if (args.stage === 'WON') { data.wonAt = new Date(); data.probability = 100; }
        if (args.stage === 'LOST') { data.lostAt = new Date(); data.probability = 0; }
      }
      if (args.value) data.value = args.value;
      if (args.notes) data.notes = args.notes;
      const deal = await prisma.deal.update({ where: { id: args.dealId as string }, data });
      return `Updated deal "${deal.title}" — stage: ${deal.stage}, value: ₹${deal.value}`;
    },
  },
  {
    definition: {
      name: 'list_deals',
      description: 'List deals with optional stage filter.',
      parameters: {
        type: 'object',
        properties: {
          stage: { type: 'string' },
          limit: { type: 'number' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      const where: Record<string, unknown> = { companyId };
      if (args.stage) where.stage = args.stage;
      const deals = await prisma.deal.findMany({ where: where as any, take: (args.limit as number) || 10, orderBy: { createdAt: 'desc' }, include: { contact: { select: { displayName: true, phoneNumber: true } } } });
      if (!deals.length) return 'No deals found';
      return deals.map((d) => `- "${d.title}" | ${d.stage} | ₹${d.value} | ${d.probability}% | ${d.contact?.displayName || 'no contact'} | ID: ${d.id}`).join('\n');
    },
  },

  // ── Tasks ─────────────────────────────────────────────────────────────────
  {
    definition: {
      name: 'create_task',
      description: 'Create a task or reminder.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title' },
          dueAt: { type: 'string', description: 'Due date in ISO format or natural language like "tomorrow"' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          contactId: { type: 'string' },
          dealId: { type: 'string' },
        },
        required: ['title'],
      },
    },
    execute: async (args, companyId) => {
      const task = await prisma.task.create({
        data: {
          companyId,
          title: args.title as string,
          dueAt: args.dueAt ? new Date(args.dueAt as string) : undefined,
          priority: ((args.priority as string) || 'MEDIUM') as any,
          status: 'TODO' as any,
          contactId: (args.contactId as string) || undefined,
          dealId: (args.dealId as string) || undefined,
        },
      });
      return `Created task: "${task.title}" | Priority: ${task.priority} | Due: ${task.dueAt?.toISOString() || 'no due date'} | ID: ${task.id}`;
    },
  },
  {
    definition: {
      name: 'update_task',
      description: 'Update task status or priority.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          status: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'] },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          title: { type: 'string' },
        },
        required: ['taskId'],
      },
    },
    execute: async (args, _companyId) => {
      const data: Record<string, unknown> = {};
      if (args.status) data.status = args.status;
      if (args.priority) data.priority = args.priority;
      if (args.title) data.title = args.title;
      if (args.status === 'DONE') data.completedAt = new Date();
      const task = await prisma.task.update({ where: { id: args.taskId as string }, data });
      return `Updated task "${task.title}" — status: ${task.status}`;
    },
  },
  {
    definition: {
      name: 'list_tasks',
      description: 'List tasks with optional status/priority filter.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          priority: { type: 'string' },
          limit: { type: 'number' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      const where: Record<string, unknown> = { companyId };
      if (args.status) where.status = args.status;
      if (args.priority) where.priority = args.priority;
      const tasks = await prisma.task.findMany({ where: where as any, take: (args.limit as number) || 10, orderBy: { createdAt: 'desc' } });
      if (!tasks.length) return 'No tasks found';
      return tasks.map((t) => `- "${t.title}" | ${t.status} | ${t.priority} | Due: ${t.dueAt?.toISOString().split('T')[0] || 'none'} | ID: ${t.id}`).join('\n');
    },
  },

  // ── WhatsApp & Communication ──────────────────────────────────────────────
  {
    definition: {
      name: 'send_whatsapp',
      description: 'Send a WhatsApp message to a contact.',
      parameters: {
        type: 'object',
        properties: {
          phoneNumber: { type: 'string', description: 'Phone number to send to' },
          text: { type: 'string', description: 'Message text' },
        },
        required: ['phoneNumber', 'text'],
      },
    },
    execute: async (args, companyId) => {
      const account = await prisma.whatsAppAccount.findFirst({ where: { companyId, status: 'CONNECTED' } });
      if (!account) return 'No connected WhatsApp account found';

      // Normalize phone number: remove +, spaces, dashes; add 91 prefix for 10-digit Indian numbers
      let phone = (args.phoneNumber as string).replace(/[\s\-\+\(\)]/g, '');
      if (phone.startsWith('0')) phone = '91' + phone.slice(1); // 08714414424 → 918714414424
      if (phone.length === 10 && /^\d+$/.test(phone)) phone = '91' + phone; // 8714414424 → 918714414424

      await redis.publish('wa:outbound', JSON.stringify({
        accountId: account.id,
        toPhone: phone,
        text: args.text as string,
      }));
      return `Message sent to ${phone}: "${(args.text as string).slice(0, 50)}..."`;
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
  {
    definition: {
      name: 'create_broadcast',
      description: 'Create a broadcast message to multiple contacts.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Broadcast name' },
          message: { type: 'string', description: 'Message text to send' },
          targetTags: { type: 'array', items: { type: 'string' }, description: 'Send to contacts with these tags' },
        },
        required: ['name', 'message'],
      },
    },
    execute: async (args, companyId) => {
      const broadcast = await prisma.broadcast.create({
        data: {
          companyId,
          name: args.name as string,
          message: args.message as string,
          targetTags: (args.targetTags as string[]) || [],
        },
      });
      return `Created broadcast "${broadcast.name}" (ID: ${broadcast.id}). Queue it from the Broadcasts page to send.`;
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
    definition: { name: 'create_template', description: 'Create a message template with variables like {{name}}.', parameters: { type: 'object', properties: { name: { type: 'string' }, body: { type: 'string', description: 'Template text with {{variables}}' }, category: { type: 'string', description: 'greeting, follow-up, payment, support' } }, required: ['name', 'body'] } },
    execute: async (args, companyId) => {
      const vars = ((args.body as string).match(/\{\{(\w+)\}\}/g) || []).map((v) => v.replace(/[{}]/g, ''));
      const t = await prisma.template.create({ data: { companyId, name: args.name as string, body: args.body as string, category: (args.category as string) || 'general', variables: vars } });
      return `Created template "${t.name}" with ${vars.length} variables`;
    },
  },
  {
    definition: { name: 'list_templates', description: 'List message templates.', parameters: { type: 'object', properties: { category: { type: 'string' } }, required: [] } },
    execute: async (args, companyId) => {
      const where: Record<string, unknown> = { companyId };
      if (args.category) where.category = args.category;
      const templates = await prisma.template.findMany({ where: where as any, take: 20 });
      if (!templates.length) return 'No templates found';
      return templates.map((t) => `- "${t.name}" [${t.category}]: ${t.body.slice(0, 60)}...`).join('\n');
    },
  },
  {
    definition: { name: 'send_template', description: 'Send a template message to a contact with variable substitution.', parameters: { type: 'object', properties: { templateName: { type: 'string' }, phoneNumber: { type: 'string' }, variables: { type: 'object', description: 'Key-value pairs for template variables' } }, required: ['templateName', 'phoneNumber'] } },
    execute: async (args, companyId) => {
      const template = await prisma.template.findFirst({ where: { companyId, name: args.templateName as string } });
      if (!template) return `Template "${args.templateName}" not found`;
      let text = template.body;
      const vars = (args.variables || {}) as Record<string, string>;
      for (const [k, v] of Object.entries(vars)) { text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v); }
      const account = await prisma.whatsAppAccount.findFirst({ where: { companyId, status: 'CONNECTED' } });
      if (!account) return 'No connected WhatsApp account';
      await redis.publish('wa:outbound', JSON.stringify({ accountId: account.id, toPhone: args.phoneNumber as string, text }));
      return `Sent template "${template.name}" to ${args.phoneNumber}`;
    },
  },

  // ── Sequences ─────────────────────────────────────────────────────────────
  {
    definition: { name: 'create_sequence', description: 'Create an auto follow-up sequence.', parameters: { type: 'object', properties: { name: { type: 'string' }, steps: { type: 'array', items: { type: 'object', properties: { delayHours: { type: 'number' }, message: { type: 'string' } } }, description: 'Array of steps with delay and message' } }, required: ['name', 'steps'] } },
    execute: async (args, companyId) => {
      const seq = await prisma.sequence.create({ data: { companyId, name: args.name as string } });
      const steps = (args.steps as Array<{ delayHours?: number; message?: string }>) || [];
      for (let i = 0; i < steps.length; i++) {
        await prisma.sequenceStep.create({ data: { sequenceId: seq.id, sortOrder: i, delayHours: steps[i].delayHours ?? 24, message: steps[i].message } });
      }
      return `Created sequence "${seq.name}" with ${steps.length} steps`;
    },
  },
  {
    definition: { name: 'enroll_in_sequence', description: 'Enroll a contact in a follow-up sequence.', parameters: { type: 'object', properties: { sequenceName: { type: 'string' }, contactId: { type: 'string' }, phoneNumber: { type: 'string' } }, required: ['sequenceName'] } },
    execute: async (args, companyId) => {
      const seq = await prisma.sequence.findFirst({ where: { companyId, name: args.sequenceName as string } });
      if (!seq) return `Sequence "${args.sequenceName}" not found`;
      let contactId = args.contactId as string;
      if (!contactId && args.phoneNumber) {
        const c = await prisma.contact.findFirst({ where: { companyId, phoneNumber: args.phoneNumber as string } });
        if (!c) return 'Contact not found';
        contactId = c.id;
      }
      if (!contactId) return 'Provide contactId or phoneNumber';
      await prisma.sequenceEnrollment.create({ data: { sequenceId: seq.id, contactId, companyId, nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
      return `Enrolled contact in sequence "${seq.name}"`;
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

  // ── Products ──────────────────────────────────────────────────────────────
  {
    definition: { name: 'create_product', description: 'Add a product to the catalog.', parameters: { type: 'object', properties: { name: { type: 'string' }, price: { type: 'number', description: 'Price in smallest unit (paise/cents)' }, description: { type: 'string' }, sku: { type: 'string' } }, required: ['name', 'price'] } },
    execute: async (args, companyId) => {
      const p = await prisma.product.create({ data: { companyId, name: args.name as string, price: args.price as number, description: (args.description as string) || undefined, sku: (args.sku as string) || undefined } });
      return `Created product "${p.name}" — ₹${p.price / 100}`;
    },
  },
  {
    definition: { name: 'list_products', description: 'List products in the catalog.', parameters: { type: 'object', properties: {}, required: [] } },
    execute: async (_args, companyId) => {
      const products = await prisma.product.findMany({ where: { companyId, isActive: true }, take: 20 });
      if (!products.length) return 'No products found';
      return products.map((p) => `- ${p.name} | ₹${p.price / 100} | SKU: ${p.sku || 'N/A'}`).join('\n');
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
  // Leads
  'create_lead', 'update_lead', 'list_leads',
  // Deals
  'create_deal', 'update_deal', 'list_deals',
  // Tasks
  'create_task', 'update_task', 'list_tasks',
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

export async function executeAdminTool(name: string, args: Record<string, unknown>, companyId: string): Promise<string> {
  const tool = tools.find((t) => t.definition.name === name);
  if (!tool) return `Unknown tool: ${name}`;
  try {
    return await tool.execute(args, companyId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Tool error: ${msg}`;
  }
}
