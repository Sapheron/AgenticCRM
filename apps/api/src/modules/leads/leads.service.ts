import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import type { LeadStatus } from '@wacrm/database';

export interface CreateLeadDto {
  contactId: string;
  title: string;
  status?: LeadStatus;
  source?: string;
  score?: number;
  estimatedValue?: number;
  currency?: string;
  notes?: string;
  customFields?: Record<string, unknown>;
  assignedAgentId?: string;
}

@Injectable()
export class LeadsService {
  async list(
    companyId: string,
    opts: { status?: LeadStatus; contactId?: string; assignedAgentId?: string; page?: number },
  ) {
    const page = opts.page ?? 1;
    const limit = 50;
    const where = {
      companyId,
      deletedAt: null,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.contactId ? { contactId: opts.contactId } : {}),
      ...(opts.assignedAgentId ? { assignedAgentId: opts.assignedAgentId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          contact: { select: { id: true, displayName: true, phoneNumber: true } },
          assignedAgent: { select: { id: true, firstName: true, lastName: true } },
          deals: { select: { id: true, title: true, stage: true, value: true } },
        },
      }),
      prisma.lead.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async get(companyId: string, id: string) {
    const lead = await prisma.lead.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        contact: true,
        assignedAgent: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        deals: true,
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async create(companyId: string, dto: CreateLeadDto) {
    return prisma.lead.create({
      data: {
        companyId,
        contactId: dto.contactId,
        title: dto.title,
        status: dto.status ?? 'NEW',
        source: dto.source,
        score: dto.score ?? 0,
        estimatedValue: dto.estimatedValue,
        currency: dto.currency ?? 'INR',
        notes: dto.notes,
        customFields: (dto.customFields ?? {}) as any,
        assignedAgentId: dto.assignedAgentId,
      },
    });
  }

  async update(companyId: string, id: string, dto: Partial<CreateLeadDto>) {
    await this.get(companyId, id);
    return prisma.lead.update({ where: { id }, data: dto as any });
  }

  async updateStatus(companyId: string, id: string, status: LeadStatus) {
    await this.get(companyId, id);
    const data: Record<string, unknown> = { status };
    if (status === 'WON') data.wonAt = new Date();
    if (status === 'LOST') data.lostAt = new Date();
    return prisma.lead.update({ where: { id }, data: data as any });
  }

  async remove(companyId: string, id: string) {
    await this.get(companyId, id);
    return prisma.lead.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Called by AI tool: create-lead */
  async createFromAi(
    companyId: string,
    contactId: string,
    title: string,
    source = 'whatsapp',
    estimatedValue?: number,
  ) {
    return this.create(companyId, { contactId, title, source, estimatedValue, status: 'NEW' });
  }
}
