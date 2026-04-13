import { Injectable } from '@nestjs/common';
import { prisma } from '@wacrm/database';

type DateRange = { start: Date; end: Date };
type GroupBy = 'day' | 'week' | 'month';

function rangeFromDays(days: number): DateRange {
  const end = new Date();
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { start, end };
}

function prevRange(range: DateRange): DateRange {
  const ms = range.end.getTime() - range.start.getTime();
  return { start: new Date(range.start.getTime() - ms), end: new Date(range.start.getTime()) };
}

function formatNum(n: number, decimals = 0) {
  return Number(n.toFixed(decimals));
}

@Injectable()
export class AnalyticsService {

  // ── KPI Dashboard ──────────────────────────────────────────────────────────

  async getDashboardStats(companyId: string, days = 30) {
    const range = rangeFromDays(days);
    const prev = prevRange(range);
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [
      totalContacts, prevContacts,
      openConversations,
      totalLeads, activeLeads, wonLeadsThisMonth,
      activeDeals,
      openTickets,
      messagesLast,
    ] = await Promise.all([
      prisma.contact.count({ where: { companyId, deletedAt: null, createdAt: { lte: range.end } } }),
      prisma.contact.count({ where: { companyId, deletedAt: null, createdAt: { lte: prev.end } } }),
      prisma.conversation.count({ where: { companyId, status: { in: ['OPEN', 'AI_HANDLING'] } } }),
      prisma.lead.count({ where: { companyId, deletedAt: null } }),
      prisma.lead.count({ where: { companyId, deletedAt: null, status: { notIn: ['WON', 'LOST', 'DISQUALIFIED'] } } }),
      prisma.lead.count({ where: { companyId, status: 'WON', wonAt: { gte: startOfMonth } } }),
      prisma.deal.count({ where: { companyId, deletedAt: null, stage: { notIn: ['WON', 'LOST'] } } }),
      prisma.ticket.count({ where: { companyId, status: { in: ['OPEN', 'IN_PROGRESS', 'ESCALATED'] } } }),
      prisma.message.count({ where: { companyId, createdAt: { gte: range.start } } }),
    ]);

    const [pipelineAgg, revenueAgg, prevRevenueAgg] = await Promise.all([
      prisma.deal.aggregate({
        where: { companyId, deletedAt: null, stage: { notIn: ['WON', 'LOST'] } },
        _sum: { value: true },
      }),
      prisma.payment.aggregate({
        where: { companyId, status: 'PAID', paidAt: { gte: range.start } },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { companyId, status: 'PAID', paidAt: { gte: prev.start, lt: prev.end } },
        _sum: { amount: true },
      }),
    ]);

    const revenue = revenueAgg._sum.amount ?? 0;
    const prevRevenue = prevRevenueAgg._sum.amount ?? 0;
    const pipelineValue = pipelineAgg._sum.value ?? 0;

    const contactDelta = prevContacts > 0 ? formatNum(((totalContacts - prevContacts) / prevContacts) * 100, 1) : 0;
    const revenueDelta = prevRevenue > 0 ? formatNum(((revenue - prevRevenue) / prevRevenue) * 100, 1) : 0;

    return {
      contacts: { total: totalContacts, delta: contactDelta },
      openLeads: { total: activeLeads, wonThisMonth: wonLeadsThisMonth },
      pipelineValue: { total: pipelineValue, activeDeals },
      revenue: { total: revenue, delta: revenueDelta },
      openTickets: { total: openTickets },
      messages: { total: messagesLast },
      openConversations,
    };
  }

  // ── Revenue ─────────────────────────────────────────────────────────────────

  async getRevenueTrends(companyId: string, days = 30, groupBy: GroupBy = 'day') {
    const range = rangeFromDays(days);
    const payments = await prisma.payment.findMany({
      where: { companyId, status: 'PAID', paidAt: { gte: range.start } },
      select: { paidAt: true, amount: true },
      orderBy: { paidAt: 'asc' },
    });
    return this._bucketByDate(payments.map(p => ({ date: p.paidAt!, value: p.amount })), range, groupBy);
  }

  // ── Conversion Funnel ────────────────────────────────────────────────────────

  async getConversionFunnel(companyId: string, days = 30) {
    const range = rangeFromDays(days);
    const where = { companyId, deletedAt: null, createdAt: { gte: range.start } };
    const [total, contacted, qualified, proposalSent, won] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.count({ where: { ...where, status: { in: ['CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'NEGOTIATING', 'WON'] } } }),
      prisma.lead.count({ where: { ...where, status: { in: ['QUALIFIED', 'PROPOSAL_SENT', 'NEGOTIATING', 'WON'] } } }),
      prisma.lead.count({ where: { ...where, status: { in: ['PROPOSAL_SENT', 'NEGOTIATING', 'WON'] } } }),
      prisma.lead.count({ where: { ...where, status: 'WON' } }),
    ]);
    return [
      { stage: 'NEW', count: total, rate: 100 },
      { stage: 'CONTACTED', count: contacted, rate: total > 0 ? formatNum((contacted / total) * 100, 1) : 0 },
      { stage: 'QUALIFIED', count: qualified, rate: total > 0 ? formatNum((qualified / total) * 100, 1) : 0 },
      { stage: 'PROPOSAL_SENT', count: proposalSent, rate: total > 0 ? formatNum((proposalSent / total) * 100, 1) : 0 },
      { stage: 'WON', count: won, rate: total > 0 ? formatNum((won / total) * 100, 1) : 0 },
    ];
  }

  // ── Deal Pipeline ────────────────────────────────────────────────────────────

  async getDealPipelineStats(companyId: string) {
    const stages = await prisma.deal.groupBy({
      by: ['stage'],
      where: { companyId, deletedAt: null },
      _count: true,
      _sum: { value: true },
    });
    const totalValue = stages.reduce((s, r) => s + (r._sum.value ?? 0), 0);
    return stages.map(r => ({
      stage: r.stage,
      count: r._count,
      value: r._sum.value ?? 0,
      weightedShare: totalValue > 0 ? formatNum(((r._sum.value ?? 0) / totalValue) * 100, 1) : 0,
    }));
  }

  // ── Lead Sources ─────────────────────────────────────────────────────────────

  async getLeadSourceBreakdown(companyId: string, days = 30) {
    const range = rangeFromDays(days);
    const sources = await prisma.lead.groupBy({
      by: ['source'],
      where: { companyId, deletedAt: null, createdAt: { gte: range.start } },
      _count: true,
    });
    const total = sources.reduce((s, r) => s + r._count, 0);
    return sources
      .filter(r => r.source)
      .map(r => ({
        source: r.source,
        count: r._count,
        rate: total > 0 ? formatNum((r._count / total) * 100, 1) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  // ── Contact Growth ────────────────────────────────────────────────────────────

  async getContactGrowth(companyId: string, days = 30, groupBy: GroupBy = 'day') {
    const range = rangeFromDays(days);
    const contacts = await prisma.contact.findMany({
      where: { companyId, deletedAt: null, createdAt: { gte: range.start } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return this._bucketByDate(contacts.map(c => ({ date: c.createdAt, value: 1 })), range, groupBy);
  }

  // ── Agent Performance ─────────────────────────────────────────────────────────

  async getAgentPerformance(companyId: string, days = 30) {
    const range = rangeFromDays(days);
    const [users, resolvedByAgent, wonByAgent, ticketsResolved, msgsByAgent] = await Promise.all([
      prisma.user.findMany({ where: { companyId }, select: { id: true, name: true, email: true } }),
      prisma.conversation.groupBy({
        by: ['assignedAgentId'],
        where: { companyId, status: 'RESOLVED', assignedAgentId: { not: null }, updatedAt: { gte: range.start } },
        _count: true,
      }),
      prisma.deal.groupBy({
        by: ['assignedAgentId'],
        where: { companyId, stage: 'WON', assignedAgentId: { not: null }, wonAt: { gte: range.start } },
        _count: true,
        _sum: { value: true },
      }),
      prisma.ticket.groupBy({
        by: ['assignedToId'],
        where: { companyId, status: 'RESOLVED', assignedToId: { not: null }, updatedAt: { gte: range.start } },
        _count: true,
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.message.groupBy as any)({
        by: ['senderId'],
        where: { companyId, direction: 'OUTBOUND', senderId: { not: null }, createdAt: { gte: range.start } },
        _count: true,
      }) as Promise<Array<{ senderId: string | null; _count: number }>>,
    ]);

    const resolvedMap = Object.fromEntries(resolvedByAgent.map(r => [r.assignedAgentId!, r._count]));
    const wonMap = Object.fromEntries(wonByAgent.map(r => [r.assignedAgentId!, { count: r._count, value: r._sum.value ?? 0 }]));
    const ticketsMap = Object.fromEntries(ticketsResolved.map(r => [r.assignedToId!, r._count]));
    const msgsMap = Object.fromEntries((msgsByAgent as Array<{ senderId: string | null; _count: number }>).map(r => [r.senderId!, r._count]));

    return users.map(u => ({
      userId: u.id,
      name: u.name,
      email: u.email,
      conversationsResolved: resolvedMap[u.id] ?? 0,
      dealsWon: wonMap[u.id]?.count ?? 0,
      dealsWonValue: wonMap[u.id]?.value ?? 0,
      ticketsResolved: ticketsMap[u.id] ?? 0,
      messagesSent: msgsMap[u.id] ?? 0,
    })).sort((a, b) => b.conversationsResolved - a.conversationsResolved);
  }

  // ── Broadcast Stats ────────────────────────────────────────────────────────────

  async getBroadcastStats(companyId: string, days = 30) {
    const range = rangeFromDays(days);
    const [total, sent, delivered, read, failed] = await Promise.all([
      prisma.broadcast.count({ where: { companyId, createdAt: { gte: range.start } } }),
      prisma.broadcastRecipient.count({ where: { broadcast: { companyId }, status: { in: ['SENT', 'DELIVERED', 'READ'] }, createdAt: { gte: range.start } } }),
      prisma.broadcastRecipient.count({ where: { broadcast: { companyId }, status: { in: ['DELIVERED', 'READ'] }, createdAt: { gte: range.start } } }),
      prisma.broadcastRecipient.count({ where: { broadcast: { companyId }, status: 'READ', createdAt: { gte: range.start } } }),
      prisma.broadcastRecipient.count({ where: { broadcast: { companyId }, status: 'FAILED', createdAt: { gte: range.start } } }),
    ]);
    return {
      totalBroadcasts: total,
      totalRecipients: sent + failed,
      sent, delivered, read, failed,
      deliveryRate: sent > 0 ? formatNum((delivered / sent) * 100, 1) : 0,
      readRate: sent > 0 ? formatNum((read / sent) * 100, 1) : 0,
    };
  }

  // ── Message Volume ─────────────────────────────────────────────────────────────

  async getMessageVolumeByChannel(companyId: string, days = 30, groupBy: GroupBy = 'day') {
    const range = rangeFromDays(days);
    const messages = await prisma.message.findMany({
      where: { companyId, createdAt: { gte: range.start } },
      select: { createdAt: true, direction: true },
      orderBy: { createdAt: 'asc' },
    });
    const inbound = this._bucketByDate(
      messages.filter(m => m.direction === 'INBOUND').map(m => ({ date: m.createdAt, value: 1 })),
      range, groupBy,
    );
    const outbound = this._bucketByDate(
      messages.filter(m => m.direction === 'OUTBOUND').map(m => ({ date: m.createdAt, value: 1 })),
      range, groupBy,
    );
    return { inbound, outbound };
  }

  // ── Ticket Stats ──────────────────────────────────────────────────────────────

  async getTicketStats(companyId: string, days = 30) {
    const range = rangeFromDays(days);
    const [open, inProgress, resolved, slaBreach] = await Promise.all([
      prisma.ticket.count({ where: { companyId, status: 'OPEN' } }),
      prisma.ticket.count({ where: { companyId, status: { in: ['IN_PROGRESS', 'ESCALATED'] } } }),
      prisma.ticket.count({ where: { companyId, status: 'RESOLVED', updatedAt: { gte: range.start } } }),
      prisma.ticket.count({ where: { companyId, slaBreachedAt: { not: null }, createdAt: { gte: range.start } } }),
    ]);
    return { open, inProgress, resolved, slaBreach };
  }

  // ── Response Times ────────────────────────────────────────────────────────────

  async getResponseTimeStats(companyId: string, days = 30) {
    const range = rangeFromDays(days);
    const tickets = await prisma.ticket.findMany({
      where: { companyId, firstResponseAt: { not: null }, createdAt: { gte: range.start } },
      select: { createdAt: true, firstResponseAt: true, resolvedAt: true },
    });
    if (tickets.length === 0) return { avgFirstResponseMs: 0, avgResolutionMs: 0, count: 0 };

    const responseMs = tickets.map(t => t.firstResponseAt!.getTime() - t.createdAt.getTime());
    const resolutionMs = tickets.filter(t => t.resolvedAt).map(t => t.resolvedAt!.getTime() - t.createdAt.getTime());

    return {
      count: tickets.length,
      avgFirstResponseMs: formatNum(responseMs.reduce((a, b) => a + b, 0) / responseMs.length),
      avgResolutionMs: resolutionMs.length > 0 ? formatNum(resolutionMs.reduce((a, b) => a + b, 0) / resolutionMs.length) : 0,
    };
  }

  // ── Top Contacts ──────────────────────────────────────────────────────────────

  async getTopContacts(companyId: string, days = 30, limit = 10) {
    const range = rangeFromDays(days);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byMessages: Array<{ contactId: string | null; _count: number }> = await (prisma.message.groupBy as any)({
      by: ['contactId'],
      where: { companyId, contactId: { not: null }, createdAt: { gte: range.start } },
      _count: true,
    });
    const sorted = byMessages
      .filter(r => r.contactId)
      .sort((a, b) => b._count - a._count)
      .slice(0, limit);
    const contactIds = sorted.map(r => r.contactId as string);
    const contacts = await prisma.contact.findMany({
      where: { id: { in: contactIds } },
      select: { id: true, displayName: true, phoneNumber: true },
    });
    const contactMap = Object.fromEntries(contacts.map(c => [c.id, c]));
    return sorted
      .filter(r => r.contactId && contactMap[r.contactId])
      .map(r => ({ ...contactMap[r.contactId!], messageCount: r._count }));
  }

  // ── Tag Analytics ──────────────────────────────────────────────────────────────

  async getTagAnalytics(companyId: string, days = 30) {
    const range = rangeFromDays(days);
    const contacts = await prisma.contact.findMany({
      where: { companyId, deletedAt: null, createdAt: { gte: range.start } },
      select: { tags: true },
    });
    const tagCounts: Record<string, number> = {};
    for (const c of contacts) {
      for (const t of c.tags) {
        tagCounts[t] = (tagCounts[t] ?? 0) + 1;
      }
    }
    return Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }));
  }

  // ── Period Comparison ──────────────────────────────────────────────────────────

  async comparePeriods(companyId: string, currentDays = 30, previousDays = 30) {
    const current = rangeFromDays(currentDays);
    const previous = prevRange(current);

    const query = (range: DateRange) => Promise.all([
      prisma.contact.count({ where: { companyId, deletedAt: null, createdAt: { gte: range.start, lte: range.end } } }),
      prisma.lead.count({ where: { companyId, deletedAt: null, createdAt: { gte: range.start, lte: range.end } } }),
      prisma.deal.count({ where: { companyId, deletedAt: null, createdAt: { gte: range.start, lte: range.end } } }),
      prisma.payment.aggregate({
        where: { companyId, status: 'PAID', paidAt: { gte: range.start, lte: range.end } },
        _sum: { amount: true },
      }),
      prisma.message.count({ where: { companyId, createdAt: { gte: range.start, lte: range.end } } }),
    ]);

    const [curr, prev] = await Promise.all([query(current), query(previous)]);

    const delta = (c: number, p: number) => p > 0 ? formatNum(((c - p) / p) * 100, 1) : (c > 0 ? 100 : 0);

    return {
      current: { contacts: curr[0], leads: curr[1], deals: curr[2], revenue: curr[3]._sum.amount ?? 0, messages: curr[4] },
      previous: { contacts: prev[0], leads: prev[1], deals: prev[2], revenue: prev[3]._sum.amount ?? 0, messages: prev[4] },
      delta: {
        contacts: delta(curr[0], prev[0]),
        leads: delta(curr[1], prev[1]),
        deals: delta(curr[2], prev[2]),
        revenue: delta(curr[3]._sum.amount ?? 0, prev[3]._sum.amount ?? 0),
        messages: delta(curr[4], prev[4]),
      },
    };
  }

  // ── CRM Summary (one-shot) ────────────────────────────────────────────────────

  async getCrmSummary(companyId: string) {
    const [dashboard, funnel, pipeline, revenue, agents] = await Promise.all([
      this.getDashboardStats(companyId, 30),
      this.getConversionFunnel(companyId, 30),
      this.getDealPipelineStats(companyId),
      this.getRevenueTrends(companyId, 30, 'month'),
      this.getAgentPerformance(companyId, 30),
    ]);
    return { dashboard, funnel, pipeline, revenue, topAgents: agents.slice(0, 5) };
  }

  // ── Legacy: keep existing callers working ─────────────────────────────────────

  async getConversationTrend(companyId: string, days = 30) {
    return this.getMessageVolumeByChannel(companyId, days, 'day');
  }

  async getDealFunnel(companyId: string) {
    return this.getDealPipelineStats(companyId);
  }

  async getLeadSources(companyId: string) {
    return this.getLeadSourceBreakdown(companyId, 90);
  }

  // ── Private helpers ────────────────────────────────────────────────────────────

  private _bucketByDate(
    items: Array<{ date: Date; value: number }>,
    range: DateRange,
    groupBy: GroupBy,
  ): Array<{ date: string; value: number }> {
    const buckets: Record<string, number> = {};
    for (const item of items) {
      const key = this._bucketKey(item.date, groupBy);
      buckets[key] = (buckets[key] ?? 0) + item.value;
    }
    // Fill gaps
    const result: Array<{ date: string; value: number }> = [];
    const cursor = new Date(range.start);
    while (cursor <= range.end) {
      const key = this._bucketKey(cursor, groupBy);
      if (!result.some(r => r.date === key)) {
        result.push({ date: key, value: buckets[key] ?? 0 });
      }
      cursor.setDate(cursor.getDate() + (groupBy === 'day' ? 1 : groupBy === 'week' ? 7 : 30));
    }
    return result;
  }

  private _bucketKey(date: Date, groupBy: GroupBy): string {
    const d = new Date(date);
    if (groupBy === 'day') return d.toISOString().slice(0, 10);
    if (groupBy === 'week') {
      const monday = new Date(d);
      monday.setDate(d.getDate() - d.getDay() + 1);
      return monday.toISOString().slice(0, 10);
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
}
