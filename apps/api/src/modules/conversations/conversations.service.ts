import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import type { ConversationStatus } from '@wacrm/database';
import { transitionFsm } from '@wacrm/shared';

@Injectable()
export class ConversationsService {
  async list(
    companyId: string,
    opts: { status?: ConversationStatus | string; agentId?: string; search?: string; page?: any; limit?: any },
  ) {
    const page = Number(opts.page) || 1;
    const limit = Math.min(Number(opts.limit) || 50, 100);
    const skip = (page - 1) * limit;

    const where = {
      companyId,
      ...(opts.status
        ? { status: { in: (typeof opts.status === 'string' ? opts.status.split(',') : [opts.status]) as ConversationStatus[] } }
        : {}),
      ...(opts.agentId ? { assignedAgentId: opts.agentId } : {}),
      ...(opts.search
        ? {
            OR: [
              { contact: { phoneNumber: { contains: opts.search } } },
              { contact: { displayName: { contains: opts.search, mode: 'insensitive' as const } } },
              { lastMessageText: { contains: opts.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { lastMessageAt: 'desc' },
        include: {
          contact: { select: { id: true, phoneNumber: true, displayName: true, avatarUrl: true } },
          assignedAgent: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          whatsappAccount: { select: { id: true, phoneNumber: true, displayName: true } },
        },
      }),
      prisma.conversation.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async get(companyId: string, id: string) {
    const conv = await prisma.conversation.findFirst({
      where: { id, companyId },
      include: {
        contact: true,
        assignedAgent: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        whatsappAccount: { select: { id: true, phoneNumber: true, displayName: true, status: true } },
      },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    return conv;
  }

  async getMessages(companyId: string, id: string, cursor?: string, limit = 50) {
    await this.get(companyId, id); // verify access
    return prisma.message.findMany({
      where: {
        conversationId: id,
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async assign(companyId: string, id: string, agentId: string | null) {
    await this.get(companyId, id);
    return prisma.conversation.update({
      where: { id },
      data: { assignedAgentId: agentId },
    });
  }

  async resolve(companyId: string, id: string) {
    const conv = await this.get(companyId, id);
    const next = transitionFsm(conv.status, 'agent_resolved');
    return prisma.conversation.update({
      where: { id },
      data: {
        status: next ?? 'RESOLVED',
        resolvedAt: new Date(),
        unreadCount: 0,
      },
    });
  }

  async toggleAi(companyId: string, id: string, enabled: boolean) {
    await this.get(companyId, id);
    return prisma.conversation.update({
      where: { id },
      data: { aiEnabled: enabled },
    });
  }

  /** Called by WhatsApp service on every inbound message. */
  async findOrCreate(
    companyId: string,
    contactId: string,
    whatsappAccountId: string,
  ) {
    const existing = await prisma.conversation.findFirst({
      where: { companyId, contactId, whatsappAccountId, status: { notIn: ['CLOSED', 'SPAM'] } },
    });
    if (existing) return { conversation: existing, isNew: false };

    const conv = await prisma.conversation.create({
      data: { companyId, contactId, whatsappAccountId, status: 'OPEN' },
    });
    return { conversation: conv, isNew: true };
  }
}
