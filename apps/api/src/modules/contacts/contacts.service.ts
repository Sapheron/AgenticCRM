import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import { InvalidPhoneError, normalizePhone } from '@wacrm/shared';

function normalizeOrBadRequest(raw: string): string {
  try {
    return normalizePhone(raw);
  } catch (e) {
    if (e instanceof InvalidPhoneError) throw new BadRequestException(e.message);
    throw e;
  }
}

export interface CreateContactDto {
  phoneNumber: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  tags?: string[];
  customFields?: Record<string, unknown>;
  notes?: string;
  lifecycleStage?: string;
  companyName?: string;
  jobTitle?: string;
  address?: string;
}

@Injectable()
export class ContactsService {
  async list(companyId: string, opts: {
    search?: string; tag?: string; lifecycle?: string;
    status?: string | string[]; page?: string | number; limit?: string | number;
  }) {
    const page = Number(opts.page) || 1;
    const limit = Math.min(Number(opts.limit) || 50, 100);
    const skip = (page - 1) * limit;

    const where: Record<string, any> = {
      companyId,
      deletedAt: null,
      ...(opts.tag ? { tags: { has: opts.tag } } : {}),
      ...(opts.lifecycle ? { lifecycleStage: opts.lifecycle } : {}),
      ...(opts.search
        ? {
            OR: [
              { phoneNumber: { contains: opts.search } },
              { displayName: { contains: opts.search, mode: 'insensitive' as const } },
              { firstName: { contains: opts.search, mode: 'insensitive' as const } },
              { lastName: { contains: opts.search, mode: 'insensitive' as const } },
              { email: { contains: opts.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.contact.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.contact.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async get(companyId: string, id: string) {
    const contact = await prisma.contact.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }

  async create(companyId: string, dto: CreateContactDto) {
    const phoneNumber = normalizeOrBadRequest(dto.phoneNumber);
    return prisma.contact.upsert({
      where: { companyId_phoneNumber: { companyId, phoneNumber } },
      create: {
        companyId,
        phoneNumber,
        displayName: dto.displayName,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        tags: dto.tags ?? [],
        customFields: (dto.customFields ?? {}) as any,
        notes: dto.notes,
        lifecycleStage: dto.lifecycleStage ?? 'SUBSCRIBER',
        companyName: dto.companyName,
        jobTitle: dto.jobTitle,
        address: dto.address,
      },
      update: {
        ...(dto.displayName ? { displayName: dto.displayName } : {}),
        ...(dto.firstName ? { firstName: dto.firstName } : {}),
        ...(dto.lastName ? { lastName: dto.lastName } : {}),
        lastSeenAt: new Date(),
      },
    });
  }

  async update(companyId: string, id: string, dto: Partial<CreateContactDto>) {
    await this.get(companyId, id);
    // Explicit whitelist — never pass raw dto to Prisma
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.phoneNumber !== undefined) data.phoneNumber = dto.phoneNumber;
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.tags !== undefined) data.tags = dto.tags;
    if (dto.customFields !== undefined) data.customFields = dto.customFields;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.lifecycleStage !== undefined) data.lifecycleStage = dto.lifecycleStage;
    if (dto.companyName !== undefined) data.companyName = dto.companyName;
    if (dto.jobTitle !== undefined) data.jobTitle = dto.jobTitle;
    if (dto.address !== undefined) data.address = dto.address;
    return prisma.contact.update({ where: { id }, data });
  }

  async softDelete(companyId: string, id: string) {
    await this.get(companyId, id);
    return prisma.contact.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async optOut(companyId: string, id: string) {
    await this.get(companyId, id);
    return prisma.contact.update({ where: { id }, data: { optedOut: true, optedOutAt: new Date() } });
  }

  async findOrCreate(companyId: string, phoneNumber: string, displayName?: string) {
    return this.create(companyId, { phoneNumber, displayName });
  }

  // ── Timeline ──────────────────────────────────────────────────────────────

  async getTimeline(companyId: string, contactId: string) {
    const [messages, leads, deals, tasks, payments, notes] = await Promise.all([
      prisma.message.findMany({
        where: { companyId, conversation: { contactId } },
        select: { id: true, direction: true, body: true, type: true, createdAt: true, isAiGenerated: true },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      prisma.lead.findMany({
        where: { companyId, contactId },
        select: { id: true, title: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.deal.findMany({
        where: { companyId, contactId },
        select: { id: true, title: true, stage: true, value: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.task.findMany({
        where: { companyId, contactId },
        select: { id: true, title: true, status: true, priority: true, dueAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.payment.findMany({
        where: { companyId, contactId },
        select: { id: true, amount: true, currency: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.contactNote.findMany({
        where: { contactId, companyId, deletedAt: null },
        select: { id: true, content: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    // Combine and sort by date
    const timeline = [
      ...messages.map((m) => ({ type: 'message' as const, date: m.createdAt, data: m })),
      ...leads.map((l) => ({ type: 'lead' as const, date: l.createdAt, data: l })),
      ...deals.map((d) => ({ type: 'deal' as const, date: d.createdAt, data: d })),
      ...tasks.map((t) => ({ type: 'task' as const, date: t.createdAt, data: t })),
      ...payments.map((p) => ({ type: 'payment' as const, date: p.createdAt, data: p })),
      ...notes.map((n) => ({ type: 'note' as const, date: n.createdAt, data: n })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return timeline.slice(0, 50);
  }

  // ── Notes ─────────────────────────────────────────────────────────────────

  async getNotes(companyId: string, contactId: string) {
    await this.get(companyId, contactId); // verify access
    return prisma.contactNote.findMany({
      where: { contactId, companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addNote(companyId: string, contactId: string, authorId: string, content: string) {
    return prisma.contactNote.create({
      data: { companyId, contactId, authorId, content },
    });
  }

  async updateNote(
    companyId: string,
    contactId: string,
    noteId: string,
    userId: string,
    content: string,
  ) {
    const trimmed = (content ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('Note content is required');
    }
    const note = await prisma.contactNote.findFirst({
      where: { id: noteId, contactId, companyId, deletedAt: null },
    });
    if (!note) throw new NotFoundException('Note not found');
    // Only the author can edit their own notes.
    if (note.authorId && note.authorId !== userId) {
      throw new BadRequestException('You can only edit your own notes');
    }
    return prisma.contactNote.update({
      where: { id: noteId },
      data: { content: trimmed },
    });
  }

  async deleteNote(companyId: string, contactId: string, noteId: string, userId: string) {
    const note = await prisma.contactNote.findFirst({
      where: { id: noteId, contactId, companyId, deletedAt: null },
    });
    if (!note) throw new NotFoundException('Note not found');
    if (note.authorId && note.authorId !== userId) {
      throw new BadRequestException('You can only delete your own notes');
    }
    await prisma.contactNote.update({
      where: { id: noteId },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  // ── Bulk Actions ──────────────────────────────────────────────────────────

  async bulkTag(companyId: string, contactIds: string[], addTags?: string[], removeTags?: string[]) {
    let updated = 0;
    for (const id of contactIds) {
      const contact = await prisma.contact.findFirst({ where: { id, companyId } });
      if (!contact) continue;

      let tags = [...contact.tags];
      if (addTags) tags = [...new Set([...tags, ...addTags])];
      if (removeTags) tags = tags.filter((t) => !removeTags.includes(t));

      await prisma.contact.update({ where: { id }, data: { tags } });
      updated++;
    }
    return { updated };
  }

  async bulkDelete(companyId: string, contactIds: string[]) {
    const result = await prisma.contact.updateMany({
      where: { id: { in: contactIds }, companyId },
      data: { deletedAt: new Date() },
    });
    return { deleted: result.count };
  }

  // ── Merge ─────────────────────────────────────────────────────────────────

  async merge(companyId: string, keepId: string, mergeId: string) {
    const keep = await this.get(companyId, keepId);
    const merge = await this.get(companyId, mergeId);

    // Merge tags
    const mergedTags = [...new Set([...keep.tags, ...merge.tags])];

    // Update the kept contact with any missing fields from the merged contact
    await prisma.contact.update({
      where: { id: keepId },
      data: {
        tags: mergedTags,
        displayName: keep.displayName || merge.displayName,
        firstName: keep.firstName || merge.firstName,
        lastName: keep.lastName || merge.lastName,
        email: keep.email || merge.email,
        companyName: keep.companyName || merge.companyName,
        jobTitle: keep.jobTitle || merge.jobTitle,
        notes: [keep.notes, merge.notes].filter(Boolean).join('\n---\n') || null,
        score: Math.max(keep.score, merge.score),
      },
    });

    // Move all relationships from merge to keep
    await Promise.all([
      prisma.conversation.updateMany({ where: { contactId: mergeId }, data: { contactId: keepId } }),
      prisma.lead.updateMany({ where: { contactId: mergeId }, data: { contactId: keepId } }),
      prisma.deal.updateMany({ where: { contactId: mergeId }, data: { contactId: keepId } }),
      prisma.task.updateMany({ where: { contactId: mergeId }, data: { contactId: keepId } }),
      prisma.payment.updateMany({ where: { contactId: mergeId }, data: { contactId: keepId } }),
      prisma.contactNote.updateMany({ where: { contactId: mergeId }, data: { contactId: keepId } }),
    ]);

    // Soft-delete the merged contact
    await prisma.contact.update({ where: { id: mergeId }, data: { deletedAt: new Date() } });

    return { kept: keepId, merged: mergeId, message: 'Contacts merged successfully' };
  }

  // ── CSV Export ─────────────────────────────────────────────────────────────

  async exportCsv(companyId: string): Promise<string> {
    const contacts = await prisma.contact.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const header = 'Name,Phone,Email,Tags,Lifecycle,Score,Company,Job Title,Created\n';
    const rows = contacts.map((c) =>
      [
        `"${(c.displayName || `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || 'Unknown').replace(/"/g, '""')}"`,
        c.phoneNumber,
        c.email ?? '',
        `"${c.tags.join(', ')}"`,
        c.lifecycleStage,
        c.score,
        `"${(c.companyName ?? '').replace(/"/g, '""')}"`,
        `"${(c.jobTitle ?? '').replace(/"/g, '""')}"`,
        c.createdAt.toISOString().split('T')[0],
      ].join(','),
    ).join('\n');

    return header + rows;
  }

  // ── CSV Import ─────────────────────────────────────────────────────────────

  async importCsv(companyId: string, csv: string) {
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return { imported: 0, errors: ['CSV must have a header row and at least one data row'] };

    const header = lines[0].toLowerCase().split(',').map((h) => h.trim().replace(/"/g, ''));
    const phoneIdx = header.findIndex((h) => h.includes('phone'));
    const nameIdx = header.findIndex((h) => h.includes('name') && !h.includes('company') && !h.includes('job'));
    const emailIdx = header.findIndex((h) => h.includes('email'));
    const tagsIdx = header.findIndex((h) => h.includes('tag'));

    if (phoneIdx === -1) return { imported: 0, errors: ['CSV must have a "phone" column'] };

    let imported = 0;
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      const phone = cols[phoneIdx];
      if (!phone) { errors.push(`Row ${i + 1}: missing phone`); continue; }

      try {
        await this.create(companyId, {
          phoneNumber: phone,
          displayName: nameIdx >= 0 ? cols[nameIdx] : undefined,
          email: emailIdx >= 0 ? cols[emailIdx] : undefined,
          tags: tagsIdx >= 0 ? cols[tagsIdx].split(';').map((t) => t.trim()).filter(Boolean) : [],
        });
        imported++;
      } catch (err: unknown) {
        errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    }

    return { imported, errors: errors.slice(0, 10) };
  }

  // ── Contact Scoring ───────────────────────────────────────────────────────

  async updateScore(contactId: string, points: number) {
    await prisma.contact.update({
      where: { id: contactId },
      data: { score: { increment: points } },
    });
  }

  // ── Lifecycle Stage Automation ────────────────────────────────────────────

  private static readonly LIFECYCLE_ORDER = [
    'SUBSCRIBER', 'LEAD', 'MQL', 'SQL', 'OPPORTUNITY', 'CUSTOMER', 'EVANGELIST',
  ];

  async advanceLifecycle(contactId: string, trigger: string) {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { lifecycleStage: true, score: true },
    });
    if (!contact) return;

    const currentIdx = ContactsService.LIFECYCLE_ORDER.indexOf(contact.lifecycleStage);
    let targetStage: string | null = null;

    switch (trigger) {
      case 'message_received':
        if (currentIdx < 1) targetStage = 'LEAD';
        break;
      case 'lead_created':
        if (currentIdx < 2) targetStage = 'MQL';
        break;
      case 'deal_created':
        if (currentIdx < 3) targetStage = 'SQL';
        break;
      case 'deal_proposal':
      case 'deal_negotiation':
        if (currentIdx < 4) targetStage = 'OPPORTUNITY';
        break;
      case 'deal_won':
        if (currentIdx < 5) targetStage = 'CUSTOMER';
        break;
      case 'score_high':
        if (currentIdx === 5 && contact.score >= 100) targetStage = 'EVANGELIST';
        break;
    }

    if (targetStage) {
      await prisma.contact.update({
        where: { id: contactId },
        data: { lifecycleStage: targetStage },
      });
    }
  }
}
