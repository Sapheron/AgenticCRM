import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUES } from '@wacrm/shared';

export interface CreateBroadcastDto {
  name: string;
  message: string;
  mediaUrl?: string;
  targetTags?: string[];
  targetContactIds?: string[];
  scheduledAt?: Date;
}

@Injectable()
export class BroadcastService {
  constructor(@InjectQueue(QUEUES.BROADCAST) private readonly broadcastQueue: Queue) {}

  async list(companyId: string, pageRaw: string | number = 1) {
    const page = Number(pageRaw) || 1;
    const limit = 20;
    const [items, total] = await Promise.all([
      prisma.broadcast.findMany({
        where: { companyId },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.broadcast.count({ where: { companyId } }),
    ]);
    return { items, total, page, limit };
  }

  async get(companyId: string, id: string) {
    const broadcast = await prisma.broadcast.findFirst({ where: { id, companyId } });
    if (!broadcast) throw new NotFoundException('Broadcast not found');
    return broadcast;
  }

  async create(companyId: string, dto: CreateBroadcastDto) {
    if (!dto.targetTags?.length && !dto.targetContactIds?.length) {
      throw new BadRequestException('Must provide targetTags or targetContactIds');
    }

    // Resolve target contacts count
    const where = {
      companyId,
      deletedAt: null,
      optedOut: false,
      ...(dto.targetTags?.length ? { tags: { hasSome: dto.targetTags } } : {}),
      ...(dto.targetContactIds?.length ? { id: { in: dto.targetContactIds } } : {}),
    };
    const totalCount = await prisma.contact.count({ where });

    const broadcast = await prisma.broadcast.create({
      data: {
        companyId,
        name: dto.name,
        message: dto.message,
        mediaUrl: dto.mediaUrl,
        targetTags: dto.targetTags ?? [],
        targetContactIds: dto.targetContactIds ?? [],
        scheduledAt: dto.scheduledAt,
        totalCount,
      },
    });

    // If no scheduledAt, queue immediately; otherwise the scheduler picks it up
    if (!dto.scheduledAt) {
      await this.broadcastQueue.add(
        'send-broadcast',
        { broadcastId: broadcast.id, companyId },
        { jobId: `broadcast-${broadcast.id}` },
      );
    }

    return broadcast;
  }

  async cancel(companyId: string, id: string) {
    const broadcast = await this.get(companyId, id);
    if (broadcast.startedAt) throw new BadRequestException('Cannot cancel a broadcast already in progress');

    // Remove from queue if queued
    const job = await this.broadcastQueue.getJob(`broadcast-${id}`);
    if (job) await job.remove();

    return prisma.broadcast.delete({ where: { id } });
  }
}
