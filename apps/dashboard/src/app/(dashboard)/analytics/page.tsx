'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api-client';
import {
  Users, TrendingUp, Briefcase, CreditCard,
  LifeBuoy, Clock, ArrowUpRight, ArrowDownRight,
  RefreshCw,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

const COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe'];
const FUNNEL_COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe'];

function fmt(n: number) {
  if (n >= 10000000) return `${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function fmtCurrency(paise: number) {
  const rupees = paise / 100;
  if (rupees >= 10000000) return `₹${(rupees / 10000000).toFixed(2)}Cr`;
  if (rupees >= 100000) return `₹${(rupees / 100000).toFixed(1)}L`;
  if (rupees >= 1000) return `₹${(rupees / 1000).toFixed(1)}K`;
  return `₹${rupees.toFixed(0)}`;
}

function Delta({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <span className={`flex items-center gap-0.5 text-[10px] font-medium ${positive ? 'text-green-600' : 'text-red-500'}`}>
      {positive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
      {Math.abs(value)}%
    </span>
  );
}

function KpiCard({
  icon: Icon, label, value, sub, delta, color = 'indigo',
}: {
  icon: React.ElementType; label: string; value: string; sub?: string; delta?: number; color?: string;
}) {
  const bg = `bg-${color}-50`;
  const ic = `text-${color}-500`;
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className={`${bg} ${ic} p-1.5 rounded-lg`}>
          <Icon size={14} />
        </span>
        {delta !== undefined && <Delta value={delta} />}
      </div>
      <div>
        <p className="text-xl font-bold text-gray-900">{value}</p>
        <p className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</p>
        {sub && <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);

  const dashboard = useQuery({
    queryKey: ['analytics-dashboard', days],
    queryFn: () => api.get(`/analytics/dashboard?days=${days}`).then(r => r.data.data),
    refetchInterval: 60000,
  });

  const revenue = useQuery({
    queryKey: ['analytics-revenue', days],
    queryFn: () => api.get(`/analytics/revenue?days=${days}&groupBy=${days <= 14 ? 'day' : days <= 60 ? 'day' : 'week'}`).then(r => r.data.data),
  });

  const funnel = useQuery({
    queryKey: ['analytics-funnel', days],
    queryFn: () => api.get(`/analytics/funnel?days=${days}`).then(r => r.data.data),
  });

  const pipeline = useQuery({
    queryKey: ['analytics-pipeline'],
    queryFn: () => api.get('/analytics/pipeline').then(r => r.data.data),
  });

  const sources = useQuery({
    queryKey: ['analytics-sources', days],
    queryFn: () => api.get(`/analytics/leads/sources?days=${days}`).then(r => r.data.data),
  });

  const agents = useQuery({
    queryKey: ['analytics-agents', days],
    queryFn: () => api.get(`/analytics/agents?days=${days}`).then(r => r.data.data),
  });

  const contactGrowth = useQuery({
    queryKey: ['analytics-contact-growth', days],
    queryFn: () => api.get(`/analytics/contacts/growth?days=${days}&groupBy=day`).then(r => r.data.data),
  });

  const compare = useQuery({
    queryKey: ['analytics-compare', days],
    queryFn: () => api.get(`/analytics/compare?days=${days}`).then(r => r.data.data),
  });

  const d = dashboard.data;
  const cmp = compare.data;

  const isLoading = dashboard.isLoading;

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-gray-50">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-gray-900">Analytics</h1>
          <p className="text-[10px] text-gray-400">Business intelligence overview</p>
        </div>
        <div className="flex items-center gap-2">
          {RANGES.map(r => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                days === r.days
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {r.label}
            </button>
          ))}
          <button
            onClick={() => { dashboard.refetch(); revenue.refetch(); }}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* KPI Strip */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 h-24 animate-pulse" />
            ))}
          </div>
        ) : d ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard
              icon={Users} label="Total Contacts" color="blue"
              value={fmt(d.contacts?.total ?? 0)}
              delta={cmp?.delta?.contacts}
              sub={`${fmt(d.contacts?.delta ?? 0)}% growth`}
            />
            <KpiCard
              icon={TrendingUp} label="Active Leads" color="indigo"
              value={fmt(d.openLeads?.total ?? 0)}
              sub={`${d.openLeads?.wonThisMonth ?? 0} won this month`}
            />
            <KpiCard
              icon={Briefcase} label="Pipeline Value" color="violet"
              value={fmtCurrency(d.pipelineValue?.total ?? 0)}
              sub={`${d.pipelineValue?.activeDeals ?? 0} active deals`}
            />
            <KpiCard
              icon={CreditCard} label={`Revenue (${days}d)`} color="green"
              value={fmtCurrency(d.revenue?.total ?? 0)}
              delta={cmp?.delta?.revenue}
            />
            <KpiCard
              icon={LifeBuoy} label="Open Tickets" color="orange"
              value={fmt(d.openTickets?.total ?? 0)}
            />
            <KpiCard
              icon={Clock} label="Messages" color="pink"
              value={fmt(d.messages?.total ?? 0)}
              delta={cmp?.delta?.messages}
              sub={`last ${days} days`}
            />
          </div>
        ) : null}

        {/* Row 1: Revenue + Funnel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Revenue Trend */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <h2 className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider mb-3">Revenue Trend</h2>
            {revenue.isLoading ? (
              <div className="h-48 animate-pulse bg-gray-50 rounded-lg" />
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={revenue.data ?? []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} tickLine={false} axisLine={false}
                    tickFormatter={(v: unknown) => typeof v === 'string' ? v.slice(5) : String(v)} />
                  <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false}
                    tickFormatter={(v: unknown) => fmtCurrency(v as number)} width={52} />
                  <Tooltip
                    formatter={(v: unknown) => [fmtCurrency(v as number), 'Revenue']}
                    labelStyle={{ fontSize: 10 }}
                    contentStyle={{ fontSize: 10, border: '1px solid #e5e7eb', borderRadius: 6 }}
                  />
                  <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Lead Conversion Funnel */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <h2 className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider mb-3">Lead Funnel</h2>
            {funnel.isLoading ? (
              <div className="h-48 animate-pulse bg-gray-50 rounded-lg" />
            ) : (
              <div className="space-y-1.5">
                {(funnel.data ?? []).map((f: { stage: string; count: number; rate: number }, i: number) => (
                  <div key={f.stage}>
                    <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                      <span>{f.stage}</span>
                      <span className="font-medium text-gray-700">{f.count} ({f.rate}%)</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${f.rate}%`, backgroundColor: FUNNEL_COLORS[i] ?? '#6366f1' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Pipeline + Lead Sources */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Deal Pipeline */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <h2 className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider mb-3">Deal Pipeline</h2>
            {pipeline.isLoading ? (
              <div className="h-40 animate-pulse bg-gray-50 rounded-lg" />
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={pipeline.data ?? []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="stage" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => fmtCurrency(v)} width={52} />
                  <Tooltip
                    formatter={(v: unknown) => [fmtCurrency(v as number), 'Value']}
                    labelStyle={{ fontSize: 10 }}
                    contentStyle={{ fontSize: 10, border: '1px solid #e5e7eb', borderRadius: 6 }}
                  />
                  <Bar dataKey="value" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Lead Sources */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <h2 className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider mb-3">Lead Sources</h2>
            {sources.isLoading ? (
              <div className="h-40 animate-pulse bg-gray-50 rounded-lg" />
            ) : (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie data={sources.data ?? []} dataKey="count" nameKey="source" cx="50%" cy="50%" outerRadius={52} innerRadius={28}>
                      {(sources.data ?? []).map((_: unknown, i: number) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: unknown) => [v as number, 'Leads']}
                      contentStyle={{ fontSize: 10, border: '1px solid #e5e7eb', borderRadius: 6 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1">
                  {(sources.data ?? []).slice(0, 6).map((s: { source: string; count: number; rate: number }, i: number) => (
                    <div key={s.source} className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-[10px] text-gray-600 flex-1 truncate">{s.source || 'Unknown'}</span>
                      <span className="text-[10px] font-medium text-gray-700">{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Row 3: Contact Growth + Agent Performance */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Contact Growth */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <h2 className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider mb-3">Contact Growth</h2>
            {contactGrowth.isLoading ? (
              <div className="h-40 animate-pulse bg-gray-50 rounded-lg" />
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={contactGrowth.data ?? []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} tickLine={false} axisLine={false}
                    tickFormatter={(v: unknown) => typeof v === 'string' ? v.slice(5) : String(v)} />
                  <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={28} />
                  <Tooltip
                    formatter={(v: unknown) => [v as number, 'New Contacts']}
                    labelStyle={{ fontSize: 10 }}
                    contentStyle={{ fontSize: 10, border: '1px solid #e5e7eb', borderRadius: 6 }}
                  />
                  <Bar dataKey="value" fill="#6366f1" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Agent Performance */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <h2 className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider mb-3">Agent Performance</h2>
            {agents.isLoading ? (
              <div className="h-40 animate-pulse bg-gray-50 rounded-lg" />
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-gray-400 uppercase tracking-wider border-b border-gray-100">
                      <th className="text-left pb-1.5 font-medium">Agent</th>
                      <th className="text-right pb-1.5 font-medium">Convos</th>
                      <th className="text-right pb-1.5 font-medium">Deals Won</th>
                      <th className="text-right pb-1.5 font-medium">Tickets</th>
                      <th className="text-right pb-1.5 font-medium">Msgs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(agents.data ?? []).slice(0, 8).map((a: {
                      userId: string; name: string;
                      conversationsResolved: number; dealsWon: number;
                      dealsWonValue: number; ticketsResolved: number; messagesSent: number;
                    }) => (
                      <tr key={a.userId} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-1.5 text-gray-700 font-medium truncate max-w-[100px]">{a.name || 'Unknown'}</td>
                        <td className="py-1.5 text-right text-gray-600">{a.conversationsResolved}</td>
                        <td className="py-1.5 text-right text-gray-600">{a.dealsWon}</td>
                        <td className="py-1.5 text-right text-gray-600">{a.ticketsResolved}</td>
                        <td className="py-1.5 text-right text-gray-600">{a.messagesSent}</td>
                      </tr>
                    ))}
                    {(!agents.data || agents.data.length === 0) && (
                      <tr><td colSpan={5} className="py-4 text-center text-gray-400">No agent data</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Period Comparison strip */}
        {cmp && (
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <h2 className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider mb-3">
              Period Comparison — Last {days}d vs Prior {days}d
            </h2>
            <div className="grid grid-cols-5 gap-3">
              {(['contacts', 'leads', 'deals', 'revenue', 'messages'] as const).map(k => {
                const delta = cmp.delta[k] as number;
                const curr = cmp.current[k] as number;
                const isRevenue = k === 'revenue';
                return (
                  <div key={k} className="text-center">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">{k}</p>
                    <p className="text-base font-bold text-gray-900">{isRevenue ? fmtCurrency(curr) : fmt(curr)}</p>
                    <Delta value={delta} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
