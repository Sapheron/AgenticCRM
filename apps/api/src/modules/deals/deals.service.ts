import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import type { DealStage } from '@wacrm/database';
import { DEAL_STAGE_ORDER } from '@wacrm/shared';

export interface CreateDealDto {
  contactId: string;
  leadId?: string;
  title: string;
  value: number;
  currency?: string;
  probability?: number;
  expectedCloseAt?: Date;
  notes?: string;
  customFields?: Record<string, unknown>;
  assignedAgentId?: string;
}

@Injectable()
export class DealsService {
  async list(companyId: string, opts: { stage?: DealStage; contactId?: string; page?: number }) {
    const page = opts.page ?? 1;
    const limit = 50;
    const where = {
      companyId,
      deletedAt: null,
      ...(opts.stage ? { stage: opts.stage } : {}),
      ...(opts.contactId ? { contactId: opts.contactId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: { contact: { select: { id: true, displayName: true, phoneNumber: true } } },
      }),
      prisma.deal.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async get(companyId: string, id: string) {
    const deal = await prisma.deal.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!deal) throw new NotFoundException('Deal not found');
    return deal;
  }

  async create(companyId: string, dto: CreateDealDto) {
    return prisma.deal.create({
      data: { companyId, ...(dto as any), stage: 'LEAD_IN' },
    });
  }

  async update(companyId: string, id: string, dto: Partial<CreateDealDto>) {
    await this.get(companyId, id);
    return prisma.deal.update({ where: { id }, data: dto as any });
  }

  async moveStage(companyId: string, id: string, stage: DealStage) {
    const deal = await this.get(companyId, id);
    const _currentIdx = DEAL_STAGE_ORDER.indexOf(deal.stage);
    const _targetIdx = DEAL_STAGE_ORDER.indexOf(stage);

    // Allow moving to any stage except jumping backwards from WON/LOST
    if (deal.stage === 'WON' || deal.stage === 'LOST') {
      throw new BadRequestException('Cannot move a closed deal');
    }

    return prisma.deal.update({
      where: { id },
      data: {
        stage,
        ...(stage === 'WON' ? { wonAt: new Date(), probability: 100 } : {}),
        ...(stage === 'LOST' ? { lostAt: new Date(), probability: 0 } : {}),
      },
    });
  }

  async remove(companyId: string, id: string) {
    await this.get(companyId, id);
    return prisma.deal.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Called by payment webhook: move deal to WON when payment succeeds. */
  async markWonByPayment(dealId: string) {
    return prisma.deal.update({
      where: { id: dealId },
      data: { stage: 'WON', wonAt: new Date(), probability: 100 },
    });
  }
}
