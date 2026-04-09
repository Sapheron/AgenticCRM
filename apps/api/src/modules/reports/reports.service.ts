import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@wacrm/database';

@Injectable()
export class ReportsService {
  async list(companyId: string, _filters: Record<string, any>) {
    return prisma.customReport.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
  }

  async get(companyId: string, id: string) {
    const record = await prisma.customReport.findFirst({ where: { id, companyId } });
    if (!record) throw new NotFoundException('Report not found');
    return record;
  }

  async create(companyId: string, data: { name: string; entity: string; filters?: any; groupBy?: string; columns?: string[] }) {
    return prisma.customReport.create({ data: { companyId, ...data } });
  }

  async update(companyId: string, id: string, data: { name?: string; entity?: string; filters?: any; groupBy?: string; columns?: string[] }) {
    await this.get(companyId, id);
    return prisma.customReport.update({ where: { id }, data });
  }

  async delete(companyId: string, id: string) {
    await this.get(companyId, id);
    return prisma.customReport.delete({ where: { id } });
  }

  async schedule(companyId: string, reportId: string, data: { frequency?: string; recipients: string[]; isActive?: boolean }) {
    await this.get(companyId, reportId);
    return prisma.scheduledReport.create({
      data: { companyId, reportId, ...data },
    });
  }

  async listScheduled(companyId: string) {
    return prisma.scheduledReport.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
  }
}
