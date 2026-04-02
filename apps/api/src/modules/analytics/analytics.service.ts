import { Injectable } from '@nestjs/common';
import { prisma } from '@wacrm/database';

@Injectable()
export class AnalyticsService {
  async getDashboardStats(companyId: string) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalContacts,
      newContactsToday,
      openConversations,
      aiHandlingConversations,
      totalLeads,
      activeLeads,
      wonLeadsThisMonth,
      totalDeals,
      activeDeals,
      wonDealsThisMonth,
      totalTasksTodo,
      overdueTasks,
      messagesLast30Days,
      aiMessagesLast30Days,
      paymentsThisMonth,
    ] = await Promise.all([
      prisma.contact.count({ where: { companyId, deletedAt: null } }),
      prisma.contact.count({ where: { companyId, deletedAt: null, createdAt: { gte: startOfDay } } }),
      prisma.conversation.count({ where: { companyId, status: 'OPEN' } }),
      prisma.conversation.count({ where: { companyId, status: 'AI_HANDLING' } }),
      prisma.lead.count({ where: { companyId, deletedAt: null } }),
      prisma.lead.count({ where: { companyId, deletedAt: null, status: { notIn: ['WON', 'LOST', 'DISQUALIFIED'] } } }),
      prisma.lead.count({ where: { companyId, status: 'WON', wonAt: { gte: startOfMonth } } }),
      prisma.deal.count({ where: { companyId, deletedAt: null } }),
      prisma.deal.count({ where: { companyId, deletedAt: null, stage: { notIn: ['WON', 'LOST'] } } }),
      prisma.deal.count({ where: { companyId, stage: 'WON', wonAt: { gte: startOfMonth } } }),
      prisma.task.count({ where: { companyId, status: { in: ['TODO', 'IN_PROGRESS'] } } }),
      prisma.task.count({ where: { companyId, status: { in: ['TODO', 'IN_PROGRESS'] }, dueAt: { lt: now } } }),
      prisma.message.count({ where: { companyId, createdAt: { gte: last30Days } } }),
      prisma.message.count({ where: { companyId, isAiGenerated: true, createdAt: { gte: last30Days } } }),
      prisma.payment.aggregate({
        where: { companyId, status: 'PAID', paidAt: { gte: startOfMonth } },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    // Pipeline value
    const pipelineValue = await prisma.deal.aggregate({
      where: { companyId, deletedAt: null, stage: { notIn: ['WON', 'LOST'] } },
      _sum: { value: true },
    });

    // Won deal value this month
    const wonDealValue = await prisma.deal.aggregate({
      where: { companyId, stage: 'WON', wonAt: { gte: startOfMonth } },
      _sum: { value: true },
    });

    return {
      contacts: { total: totalContacts, newToday: newContactsToday },
      conversations: { open: openConversations, aiHandling: aiHandlingConversations },
      leads: { total: totalLeads, active: activeLeads, wonThisMonth: wonLeadsThisMonth },
      deals: {
        total: totalDeals,
        active: activeDeals,
        wonThisMonth: wonDealsThisMonth,
        pipelineValue: pipelineValue._sum.value ?? 0,
        wonValueThisMonth: wonDealValue._sum.value ?? 0,
      },
      tasks: { todo: totalTasksTodo, overdue: overdueTasks },
      messages: {
        last30Days: messagesLast30Days,
        aiGeneratedLast30Days: aiMessagesLast30Days,
        aiRate: messagesLast30Days > 0 ? Math.round((aiMessagesLast30Days / messagesLast30Days) * 100) : 0,
      },
      payments: {
        totalPaidThisMonth: paymentsThisMonth._sum.amount ?? 0,
        countThisMonth: paymentsThisMonth._count,
      },
    };
  }

  async getConversationTrend(companyId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const messages = await prisma.message.groupBy({
      by: ['direction'],
      where: { companyId, createdAt: { gte: since } },
      _count: true,
    });
    return messages;
  }

  async getDealFunnel(companyId: string) {
    const stages = await prisma.deal.groupBy({
      by: ['stage'],
      where: { companyId, deletedAt: null },
      _count: true,
      _sum: { value: true },
    });
    return stages;
  }

  async getLeadSources(companyId: string) {
    const sources = await prisma.lead.groupBy({
      by: ['source'],
      where: { companyId, deletedAt: null },
      _count: true,
    });
    return sources;
  }

  async getAgentPerformance(companyId: string) {
    const [resolvedByAgent, tasksByAgent] = await Promise.all([
      prisma.conversation.groupBy({
        by: ['assignedAgentId'],
        where: { companyId, status: 'RESOLVED', assignedAgentId: { not: null } },
        _count: true,
      }),
      prisma.task.groupBy({
        by: ['assignedAgentId'],
        where: { companyId, status: 'DONE', assignedAgentId: { not: null } },
        _count: true,
      }),
    ]);

    return { resolvedByAgent, tasksByAgent };
  }
}
