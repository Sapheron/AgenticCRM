import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import type { TaskStatus, TaskPriority } from '@wacrm/database';

export interface CreateTaskDto {
  contactId?: string;
  dealId?: string;
  assignedAgentId?: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueAt?: Date;
}

@Injectable()
export class TasksService {
  async list(
    companyId: string,
    opts: {
      status?: any;
      assignedAgentId?: string;
      contactId?: string;
      dealId?: string;
      overdue?: boolean;
      page?: any;
    },
  ) {
    const page = Number(opts.page) || 1;
    const limit = 50;
    const where: Record<string, unknown> = {
      companyId,
      ...(opts.status
        ? {
            status: typeof opts.status === 'string' && opts.status.includes(',')
              ? { in: opts.status.split(',') as TaskStatus[] }
              : opts.status,
          }
        : {}),
      ...(opts.assignedAgentId ? { assignedAgentId: opts.assignedAgentId } : {}),
      ...(opts.contactId ? { contactId: opts.contactId } : {}),
      ...(opts.dealId ? { dealId: opts.dealId } : {}),
      ...(opts.overdue
        ? { dueAt: { lt: new Date() }, status: { notIn: ['DONE', 'CANCELLED'] } }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }],
        include: {
          contact: { select: { id: true, displayName: true, phoneNumber: true } },
          assignedAgent: { select: { id: true, firstName: true, lastName: true } },
          deal: { select: { id: true, title: true, stage: true } },
        },
      }),
      prisma.task.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async get(companyId: string, id: string) {
    const task = await prisma.task.findFirst({
      where: { id, companyId },
      include: {
        contact: { select: { id: true, displayName: true, phoneNumber: true } },
        assignedAgent: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        deal: { select: { id: true, title: true, stage: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async create(companyId: string, createdById: string, dto: CreateTaskDto) {
    return prisma.task.create({
      data: {
        companyId,
        createdById,
        contactId: dto.contactId,
        dealId: dto.dealId,
        assignedAgentId: dto.assignedAgentId,
        title: dto.title,
        description: dto.description,
        status: dto.status ?? 'TODO',
        priority: dto.priority ?? 'MEDIUM',
        dueAt: dto.dueAt,
      },
    });
  }

  async update(companyId: string, id: string, dto: Partial<CreateTaskDto>) {
    await this.get(companyId, id);
    return prisma.task.update({ where: { id }, data: dto });
  }

  async complete(companyId: string, id: string) {
    await this.get(companyId, id);
    return prisma.task.update({
      where: { id },
      data: { status: 'DONE', completedAt: new Date() },
    });
  }

  async remove(companyId: string, id: string) {
    await this.get(companyId, id);
    return prisma.task.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  /** Called by reminder processor — find tasks due in next 30 min that haven't had reminder sent */
  async getDueForReminder() {
    const soon = new Date(Date.now() + 30 * 60 * 1000);
    return prisma.task.findMany({
      where: {
        status: { in: ['TODO', 'IN_PROGRESS'] },
        dueAt: { lte: soon, gt: new Date() },
        reminderSentAt: null,
      },
      include: {
        assignedAgent: { select: { id: true, email: true, firstName: true } },
        contact: { select: { id: true, displayName: true } },
      },
    });
  }

  async markReminderSent(id: string) {
    return prisma.task.update({ where: { id }, data: { reminderSentAt: new Date() } });
  }

  /** Called by AI tool: create-task */
  async createFromAi(
    companyId: string,
    contactId: string,
    title: string,
    dueAt?: Date,
    assignedAgentId?: string,
  ) {
    return prisma.task.create({
      data: {
        companyId,
        contactId,
        title,
        dueAt,
        assignedAgentId,
        status: 'TODO',
        priority: 'MEDIUM',
      },
    });
  }
}
