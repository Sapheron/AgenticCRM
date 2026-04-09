import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@wacrm/database';

@Injectable()
export class SequencesService {
  async list(companyId: string, _filters: Record<string, any>) {
    return prisma.sequence.findMany({
      where: { companyId },
      include: { steps: { orderBy: { sortOrder: 'asc' } }, enrollments: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(companyId: string, id: string) {
    const record = await prisma.sequence.findFirst({
      where: { id, companyId },
      include: { steps: { orderBy: { sortOrder: 'asc' } }, enrollments: true },
    });
    if (!record) throw new NotFoundException('Sequence not found');
    return record;
  }

  async create(companyId: string, data: { name: string; isActive?: boolean; steps?: { sortOrder: number; delayHours?: number; action?: string; message?: string; templateId?: string }[] }) {
    const { steps, ...rest } = data;
    return prisma.sequence.create({
      data: {
        companyId,
        ...rest,
        ...(steps ? { steps: { create: steps } } : {}),
      },
      include: { steps: true },
    });
  }

  async update(companyId: string, id: string, data: { name?: string; isActive?: boolean }) {
    await this.get(companyId, id);
    return prisma.sequence.update({ where: { id }, data });
  }

  async delete(companyId: string, id: string) {
    await this.get(companyId, id);
    return prisma.sequence.delete({ where: { id } });
  }

  async addStep(companyId: string, sequenceId: string, data: { sortOrder: number; delayHours?: number; action?: string; message?: string; templateId?: string }) {
    await this.get(companyId, sequenceId);
    return prisma.sequenceStep.create({ data: { sequenceId, ...data } });
  }

  async enroll(companyId: string, sequenceId: string, contactId: string) {
    await this.get(companyId, sequenceId);
    return prisma.sequenceEnrollment.create({ data: { sequenceId, contactId, companyId } });
  }
}
