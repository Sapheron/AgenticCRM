import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@wacrm/database';

@Injectable()
export class PipelinesService {
  async list(companyId: string, _filters: Record<string, any>) {
    return prisma.pipeline.findMany({
      where: { companyId },
      include: { stages: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(companyId: string, id: string) {
    const record = await prisma.pipeline.findFirst({
      where: { id, companyId },
      include: { stages: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!record) throw new NotFoundException('Pipeline not found');
    return record;
  }

  async create(companyId: string, data: { name: string; isDefault?: boolean; stages?: { name: string; color?: string; sortOrder: number; probability?: number }[] }) {
    const { stages, ...rest } = data;
    return prisma.pipeline.create({
      data: {
        companyId,
        ...rest,
        ...(stages ? { stages: { create: stages } } : {}),
      },
      include: { stages: true },
    });
  }

  async update(companyId: string, id: string, data: { name?: string; isDefault?: boolean }) {
    await this.get(companyId, id);
    return prisma.pipeline.update({ where: { id }, data });
  }

  async delete(companyId: string, id: string) {
    await this.get(companyId, id);
    return prisma.pipeline.delete({ where: { id } });
  }

  async addStage(companyId: string, pipelineId: string, data: { name: string; color?: string; sortOrder: number; probability?: number }) {
    await this.get(companyId, pipelineId);
    return prisma.pipelineStage.create({ data: { pipelineId, ...data } });
  }
}
