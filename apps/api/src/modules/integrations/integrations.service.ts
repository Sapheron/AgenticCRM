import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma, IntegrationType } from '@wacrm/database';

@Injectable()
export class IntegrationsService {
  async list(companyId: string, _filters: Record<string, any>) {
    return prisma.integration.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
  }

  async get(companyId: string, id: string) {
    const record = await prisma.integration.findFirst({ where: { id, companyId } });
    if (!record) throw new NotFoundException('Integration not found');
    return record;
  }

  async create(companyId: string, data: { type: string; config?: any; isActive?: boolean }) {
    return prisma.integration.create({ data: { companyId, ...data, type: data.type as IntegrationType } });
  }

  async update(companyId: string, id: string, data: { config?: any; isActive?: boolean }) {
    await this.get(companyId, id);
    return prisma.integration.update({ where: { id }, data });
  }

  async delete(companyId: string, id: string) {
    await this.get(companyId, id);
    return prisma.integration.delete({ where: { id } });
  }

  async listCalendarEvents(companyId: string, filters: { from?: string; to?: string }) {
    const where: any = { companyId };
    if (filters.from || filters.to) {
      where.startAt = {};
      if (filters.from) where.startAt.gte = new Date(filters.from);
      if (filters.to) where.startAt.lte = new Date(filters.to);
    }
    return prisma.calendarEvent.findMany({ where, orderBy: { startAt: 'asc' } });
  }

  async createCalendarEvent(companyId: string, data: { title: string; description?: string; startAt: string; endAt: string; location?: string; contactId?: string; dealId?: string }) {
    const { startAt, endAt, ...rest } = data;
    return prisma.calendarEvent.create({
      data: { companyId, startAt: new Date(startAt), endAt: new Date(endAt), ...rest },
    });
  }

  async deleteCalendarEvent(companyId: string, eventId: string) {
    const record = await prisma.calendarEvent.findFirst({ where: { id: eventId, companyId } });
    if (!record) throw new NotFoundException('Calendar event not found');
    return prisma.calendarEvent.delete({ where: { id: eventId } });
  }
}
