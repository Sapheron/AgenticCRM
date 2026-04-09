/**
 * Admin CRM Tools — AI can control the entire CRM via these tools.
 * Each tool has: name, description, parameters (JSON Schema), execute function.
 */
import { prisma } from '@wacrm/database';
import Redis from 'ioredis';

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
      const contact = await prisma.contact.create({
        data: {
          companyId,
          phoneNumber: args.phoneNumber as string,
          displayName: (args.displayName as string) || undefined,
          email: (args.email as string) || undefined,
          tags: (args.tags as string[]) || [],
        },
      });
      return `Created contact: ${contact.displayName || contact.phoneNumber} (ID: ${contact.id})`;
    },
  },
  {
    definition: {
      name: 'update_contact',
      description: 'Update an existing contact. Can update name, email, phone, tags, notes.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'Contact ID' },
          phoneNumber: { type: 'string', description: 'Phone to search by (if no contactId)' },
          displayName: { type: 'string' },
          email: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
        required: [],
      },
    },
    execute: async (args, companyId) => {
      let id = args.contactId as string;
      if (!id && args.phoneNumber) {
        const found = await prisma.contact.findFirst({ where: { companyId, phoneNumber: args.phoneNumber as string } });
        if (!found) return `Contact not found with phone ${args.phoneNumber}`;
        id = found.id;
      }
      if (!id) return 'Please provide a contactId or phoneNumber';
      const data: Record<string, unknown> = {};
      if (args.displayName) data.displayName = args.displayName;
      if (args.email) data.email = args.email;
      if (args.tags) data.tags = args.tags;
      if (args.notes) data.notes = args.notes;
      const updated = await prisma.contact.update({ where: { id }, data });
      return `Updated contact: ${updated.displayName || updated.phoneNumber}`;
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
        const found = await prisma.contact.findFirst({ where: { companyId, phoneNumber: args.phoneNumber as string } });
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
      await redis.publish('wa:outbound', JSON.stringify({
        accountId: account.id,
        toPhone: args.phoneNumber as string,
        text: args.text as string,
      }));
      return `Message sent to ${args.phoneNumber}: "${(args.text as string).slice(0, 50)}..."`;
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
];

// ── Exports ─────────────────────────────────────────────────────────────────

export function getAdminToolDefinitions(): ToolDefinition[] {
  return tools.map((t) => t.definition);
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
