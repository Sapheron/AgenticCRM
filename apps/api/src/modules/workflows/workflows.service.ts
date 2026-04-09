import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@wacrm/database';

@Injectable()
export class WorkflowsService {
  async list(companyId: string, _filters: Record<string, any>) {
    return prisma.workflow.findMany({
      where: { companyId },
      include: { _count: { select: { executions: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(companyId: string, id: string) {
    const record = await prisma.workflow.findFirst({
      where: { id, companyId },
      include: { _count: { select: { executions: true } } },
    });
    if (!record) throw new NotFoundException('Workflow not found');
    return record;
  }

  async create(companyId: string, data: { name: string; isActive?: boolean; trigger?: any; steps?: any }) {
    return prisma.workflow.create({ data: { companyId, ...data } });
  }

  async update(companyId: string, id: string, data: { name?: string; isActive?: boolean; trigger?: any; steps?: any }) {
    await this.get(companyId, id);
    return prisma.workflow.update({ where: { id }, data });
  }

  async delete(companyId: string, id: string) {
    await this.get(companyId, id);
    return prisma.workflow.delete({ where: { id } });
  }

  async listExecutions(companyId: string, workflowId: string) {
    await this.get(companyId, workflowId);
    return prisma.workflowExecution.findMany({
      where: { workflowId, companyId },
      orderBy: { startedAt: 'desc' },
    });
  }
}
