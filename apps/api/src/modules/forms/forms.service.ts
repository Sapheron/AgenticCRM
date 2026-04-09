import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@wacrm/database';

@Injectable()
export class FormsService {
  async list(companyId: string, _filters: Record<string, any>) {
    return prisma.form.findMany({
      where: { companyId },
      include: { _count: { select: { submissions: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(companyId: string, id: string) {
    const record = await prisma.form.findFirst({
      where: { id, companyId },
      include: { _count: { select: { submissions: true } } },
    });
    if (!record) throw new NotFoundException('Form not found');
    return record;
  }

  async create(companyId: string, data: { name: string; fields?: any; isActive?: boolean }) {
    return prisma.form.create({ data: { companyId, ...data } });
  }

  async update(companyId: string, id: string, data: { name?: string; fields?: any; isActive?: boolean }) {
    await this.get(companyId, id);
    return prisma.form.update({ where: { id }, data });
  }

  async delete(companyId: string, id: string) {
    await this.get(companyId, id);
    return prisma.form.delete({ where: { id } });
  }

  async listSubmissions(companyId: string, formId: string) {
    await this.get(companyId, formId);
    return prisma.formSubmission.findMany({
      where: { formId, companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createSubmission(companyId: string, formId: string, data: { data: any; contactId?: string; leadId?: string; utmSource?: string; utmMedium?: string; utmCampaign?: string; ipAddress?: string }) {
    await this.get(companyId, formId);
    return prisma.formSubmission.create({ data: { formId, companyId, ...data } });
  }
}
