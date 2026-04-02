'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { formatCurrency } from '@/lib/utils';
import { MessageSquare, Users, TrendingUp, Briefcase, CheckSquare, Bot, CreditCard } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface DashboardStats {
  contacts: { total: number; newToday: number };
  conversations: { open: number; aiHandling: number };
  leads: { total: number; active: number; wonThisMonth: number };
  deals: { total: number; active: number; wonThisMonth: number; pipelineValue: number; wonValueThisMonth: number };
  tasks: { todo: number; overdue: number };
  messages: { last30Days: number; aiGeneratedLast30Days: number; aiRate: number };
  payments: { totalPaidThisMonth: number; countThisMonth: number };
}

function StatCard({ icon: Icon, label, value, sub, color = 'green' }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string;
}) {
  const colorMap: Record<string, string> = {
    green: 'bg-green-50 text-green-600',
    blue: 'bg-blue-50 text-blue-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
    red: 'bg-red-50 text-red-600',
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${colorMap[color] ?? colorMap.green}`}>
          <Icon size={18} />
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

const STAGE_COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#6b7280'];

export default function AnalyticsPage() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['analytics-dashboard'],
    queryFn: async () => {
      const res = await api.get<{ data: DashboardStats }>('/analytics/dashboard');
      return res.data.data;
    },
    refetchInterval: 60000,
  });

  const { data: funnel } = useQuery({
    queryKey: ['deal-funnel'],
    queryFn: async () => {
      const res = await api.get<{ data: Array<{ stage: string; _count: number; _sum: { value: number } }> }>('/analytics/deals/funnel');
      return res.data.data;
    },
  });

  const { data: sources } = useQuery({
    queryKey: ['lead-sources'],
    queryFn: async () => {
      const res = await api.get<{ data: Array<{ source: string | null; _count: number }> }>('/analytics/leads/sources');
      return res.data.data;
    },
  });

  if (isLoading || !stats) {
    return <div className="p-6 text-gray-400">Loading analytics…</div>;
  }

  const funnelChartData = funnel?.map((f) => ({ name: f.stage, count: f._count, value: f._sum?.value ?? 0 })) ?? [];
  const sourcesChartData = sources?.filter((s) => s.source).map((s) => ({ name: s.source ?? 'unknown', value: s._count })) ?? [];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Analytics</h1>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total Contacts" value={stats.contacts.total.toLocaleString()} sub={`+${stats.contacts.newToday} today`} color="blue" />
        <StatCard icon={MessageSquare} label="Open Conversations" value={stats.conversations.open} sub={`${stats.conversations.aiHandling} handled by AI`} color="green" />
        <StatCard icon={TrendingUp} label="Active Leads" value={stats.leads.active} sub={`${stats.leads.wonThisMonth} won this month`} color="purple" />
        <StatCard icon={Briefcase} label="Pipeline Value" value={formatCurrency(stats.deals.pipelineValue * 100)} sub={`${stats.deals.active} active deals`} color="orange" />
        <StatCard icon={CheckSquare} label="Tasks Due" value={stats.tasks.todo} sub={stats.tasks.overdue > 0 ? `${stats.tasks.overdue} overdue` : 'None overdue'} color={stats.tasks.overdue > 0 ? 'red' : 'green'} />
        <StatCard icon={Bot} label="AI Reply Rate" value={`${stats.messages.aiRate}%`} sub={`${stats.messages.aiGeneratedLast30Days.toLocaleString()} AI msgs (30d)`} color="blue" />
        <StatCard icon={MessageSquare} label="Messages (30d)" value={stats.messages.last30Days.toLocaleString()} color="purple" />
        <StatCard icon={CreditCard} label="Revenue This Month" value={formatCurrency(stats.payments.totalPaidThisMonth)} sub={`${stats.payments.countThisMonth} payments`} color="green" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Deal Funnel */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Deal Pipeline</h3>
          {funnelChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={funnelChartData}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No deal data yet</div>
          )}
        </div>

        {/* Lead Sources */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Lead Sources</h3>
          {sourcesChartData.length > 0 ? (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width="50%" height={180}>
                <PieChart>
                  <Pie data={sourcesChartData} dataKey="value" cx="50%" cy="50%" outerRadius={70}>
                    {sourcesChartData.map((_, i) => (
                      <Cell key={i} fill={STAGE_COLORS[i % STAGE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {sourcesChartData.map((s, i) => (
                  <div key={s.name} className="flex items-center gap-2 text-sm">
                    <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: STAGE_COLORS[i % STAGE_COLORS.length] }} />
                    <span className="text-gray-600">{s.name}</span>
                    <span className="font-semibold text-gray-900 ml-auto">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No lead data yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
