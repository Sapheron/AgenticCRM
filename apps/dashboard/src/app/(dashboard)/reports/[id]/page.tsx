'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  ArrowLeft, FileBarChart, Archive, ArchiveRestore, Trash2,
  Copy, Play, MessageSquarePlus, Clock, Calendar,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  BarChart, Bar, FunnelChart, Funnel, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

type ReportStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
type ReportType = 'TABLE' | 'CHART' | 'FUNNEL' | 'METRIC' | 'COHORT';

interface Report {
  id: string;
  name: string;
  entity: string;
  type: ReportType;
  status: ReportStatus;
  description?: string;
  tags: string[];
  isPublic: boolean;
  filters?: Record<string, unknown>;
  groupBy?: string;
  columns?: string[];
  notes?: string;
  lastRunAt?: string;
  lastRunResult?: unknown;
  createdAt: string;
}

interface RunResult {
  reportId: string;
  entity: string;
  total: number;
  rows: unknown[];
  runAt: string;
}

interface ActivityEvent {
  id: string;
  type: string;
  actorType: string;
  title: string;
  createdAt: string;
}

const STATUS_COLORS: Record<ReportStatus, string> = {
  DRAFT:    'bg-gray-100 text-gray-500',
  ACTIVE:   'bg-emerald-50 text-emerald-600',
  ARCHIVED: 'bg-red-50 text-red-400',
};

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const [tab, setTab] = useState<'builder' | 'results' | 'activity'>('builder');
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [note, setNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  // Schedule form
  const [showSchedule, setShowSchedule] = useState(false);
  const [schedFreq, setSchedFreq] = useState('WEEKLY');
  const [schedEmails, setSchedEmails] = useState('');

  const { data: report, isLoading } = useQuery<Report>({
    queryKey: ['report', id],
    queryFn: async () => {
      const r = await api.get<{ data: Report }>(`/reports/${id}`);
      return r.data.data;
    },
  });

  const { data: timeline = [] } = useQuery<ActivityEvent[]>({
    queryKey: ['report-timeline', id],
    queryFn: async () => {
      const r = await api.get<{ data: ActivityEvent[] }>(`/reports/${id}/timeline`);
      return r.data.data;
    },
    enabled: tab === 'activity',
  });

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['report', id] });
    void qc.invalidateQueries({ queryKey: ['reports'] });
    void qc.invalidateQueries({ queryKey: ['report-stats'] });
  }

  const runMut = useMutation({
    mutationFn: () => api.post(`/reports/${id}/run`),
    onSuccess: (r: any) => {
      setRunResult(r.data.data);
      setTab('results');
      refresh();
      toast.success(`Ran — ${r.data.data?.total ?? 0} rows`);
    },
    onError: () => toast.error('Failed to run'),
  });

  const archiveMut = useMutation({
    mutationFn: () => api.post(`/reports/${id}/archive`),
    onSuccess: () => { refresh(); toast.success('Archived'); },
  });

  const restoreMut = useMutation({
    mutationFn: () => api.post(`/reports/${id}/restore`),
    onSuccess: () => { refresh(); toast.success('Restored'); },
  });

  const duplicateMut = useMutation({
    mutationFn: () => api.post(`/reports/${id}/duplicate`),
    onSuccess: (r: any) => {
      const newId = r.data.data?.id;
      toast.success('Duplicated');
      if (newId) router.push(`/reports/${newId}`);
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/reports/${id}`),
    onSuccess: () => { toast.success('Deleted'); router.push('/reports'); },
  });

  const addNoteMut = useMutation({
    mutationFn: () => api.post(`/reports/${id}/notes`, { note }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['report-timeline', id] });
      setNote(''); setAddingNote(false); toast.success('Note added');
    },
  });

  const scheduleMut = useMutation({
    mutationFn: () => api.post(`/reports/${id}/schedule`, {
      frequency: schedFreq,
      recipients: schedEmails.split(',').map(e => e.trim()).filter(Boolean),
    }),
    onSuccess: () => {
      setShowSchedule(false); toast.success('Report scheduled');
    },
    onError: () => toast.error('Failed to schedule'),
  });

  if (isLoading) {
    return <div className="h-full flex items-center justify-center text-xs text-gray-400">Loading...</div>;
  }
  if (!report) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <p className="text-xs text-gray-400">Report not found</p>
        <Link href="/reports" className="text-xs text-gray-800 hover:underline">Back</Link>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center gap-3 shrink-0 bg-white">
        <Link href="/reports" className="text-gray-400 hover:text-gray-600"><ArrowLeft size={14} /></Link>
        <FileBarChart size={13} className="text-gray-800 shrink-0" />
        <span className="text-xs font-semibold text-gray-900 flex-1 truncate">{report.name}</span>
        <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', STATUS_COLORS[report.status])}>
          {report.status}
        </span>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left */}
        <aside className="w-52 border-r border-gray-200 bg-white shrink-0 overflow-y-auto p-3 space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-400">Entity</span>
              <span className="text-xs font-medium text-gray-700 capitalize">{report.entity}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-400">Type</span>
              <span className="text-xs font-medium text-gray-700">{report.type}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-400">Public</span>
              <span className="text-xs font-medium text-gray-700">{report.isPublic ? 'Yes' : 'No'}</span>
            </div>
          </div>

          {report.tags.length > 0 && (
            <>
              <hr className="border-gray-100" />
              <div className="flex flex-wrap gap-1">
                {report.tags.map((t) => (
                  <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-800">{t}</span>
                ))}
              </div>
            </>
          )}

          {report.description && (
            <>
              <hr className="border-gray-100" />
              <p className="text-[11px] text-gray-500">{report.description}</p>
            </>
          )}

          <hr className="border-gray-100" />
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Clock size={9} className="text-gray-300" />
              <span className="text-[10px] text-gray-400">Created {new Date(report.createdAt).toLocaleDateString()}</span>
            </div>
            {report.lastRunAt && (
              <div className="flex items-center gap-1.5">
                <Play size={9} className="text-gray-300" />
                <span className="text-[10px] text-gray-400">Last run {new Date(report.lastRunAt).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        </aside>

        {/* Center */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="border-b border-gray-200 bg-white px-4 flex gap-4 shrink-0">
            {(['builder', 'results', 'activity'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={cn('py-2.5 text-[11px] font-medium capitalize border-b-2 transition-colors',
                  tab === t ? 'border-gray-800 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600')}>
                {t}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto p-4">
            {tab === 'builder' && (
              <div className="space-y-4">
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <h3 className="text-xs font-semibold text-gray-700 mb-3">Filters</h3>
                  <pre className="text-[11px] text-gray-600 font-mono whitespace-pre-wrap">
                    {JSON.stringify(report.filters ?? {}, null, 2)}
                  </pre>
                </div>
                {report.columns && report.columns.length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h3 className="text-xs font-semibold text-gray-700 mb-2">Columns</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {report.columns.map((c) => (
                        <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono">{c}</span>
                      ))}
                    </div>
                  </div>
                )}
                {report.groupBy && (
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h3 className="text-xs font-semibold text-gray-700 mb-1">Group By</h3>
                    <span className="text-[11px] text-gray-600 font-mono">{report.groupBy}</span>
                  </div>
                )}
                {report.notes && (
                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                    <p className="text-[10px] font-semibold text-amber-500 mb-1">NOTES</p>
                    <p className="text-xs text-amber-700">{report.notes}</p>
                  </div>
                )}
              </div>
            )}

            {tab === 'results' && (
              <div>
                {!runResult ? (
                  <div className="text-center py-12">
                    <FileBarChart size={24} className="mx-auto mb-2 text-gray-200" />
                    <p className="text-xs text-gray-400">No results yet — click Run to execute this report</p>
                    <button onClick={() => runMut.mutate()} disabled={runMut.isPending}
                      className="mt-3 flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded bg-gray-900 text-white hover:bg-gray-900 mx-auto disabled:opacity-40">
                      <Play size={10} /> {runMut.isPending ? 'Running...' : 'Run Report'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-700">{runResult.total} rows from &quot;{runResult.entity}&quot;</span>
                      <span className="text-[10px] text-gray-400 ml-auto">Run at {new Date(runResult.runAt).toLocaleString()}</span>
                    </div>
                    <ReportResultView type={report.type} rows={runResult.rows} />
                  </div>
                )}
              </div>
            )}

            {tab === 'activity' && (
              <div className="space-y-2">
                {addingNote ? (
                  <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Add a note..."
                      className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-gray-400" />
                    <div className="flex gap-2">
                      <button onClick={() => addNoteMut.mutate()} disabled={!note.trim() || addNoteMut.isPending}
                        className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-40">Save</button>
                      <button onClick={() => setAddingNote(false)} className="text-gray-400 text-[11px]">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setAddingNote(true)}
                    className="flex items-center gap-1.5 text-[11px] text-gray-800 hover:text-gray-900">
                    <MessageSquarePlus size={12} /> Add note
                  </button>
                )}

                {timeline.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <Clock size={20} className="mx-auto mb-2 text-gray-200" />
                    <p className="text-xs">No activity yet</p>
                  </div>
                ) : (
                  <div className="relative pl-4 space-y-0">
                    {timeline.map((e, i) => (
                      <div key={e.id} className="relative pb-3">
                        {i < timeline.length - 1 && <span className="absolute left-[-9px] top-3.5 bottom-0 w-px bg-gray-100" />}
                        <span className="absolute left-[-13px] top-1.5 w-2 h-2 rounded-full bg-gray-400 border-2 border-white" />
                        <div className="bg-white border border-gray-100 rounded-lg px-3 py-2">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[11px] font-medium text-gray-700">{e.title}</p>
                            <span className="text-[9px] text-gray-300 shrink-0">{new Date(e.createdAt).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        {/* Right */}
        <aside className="w-40 border-l border-gray-200 bg-white shrink-0 p-3 flex flex-col gap-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Actions</p>

          <button onClick={() => runMut.mutate()} disabled={runMut.isPending}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded bg-gray-900 hover:bg-gray-900 text-white font-medium w-full">
            <Play size={10} /> {runMut.isPending ? 'Running...' : 'Run'}
          </button>

          <button onClick={() => duplicateMut.mutate()} disabled={duplicateMut.isPending}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border border-gray-200 hover:bg-gray-50 text-gray-600 w-full">
            <Copy size={10} /> Duplicate
          </button>

          <button onClick={() => setShowSchedule(!showSchedule)}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border border-gray-200 hover:bg-gray-50 text-gray-600 w-full">
            <Calendar size={10} /> Schedule
          </button>

          {report.status !== 'ARCHIVED' ? (
            <button onClick={() => archiveMut.mutate()} disabled={archiveMut.isPending}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border border-gray-200 hover:bg-gray-50 text-gray-500 w-full">
              <Archive size={10} /> Archive
            </button>
          ) : (
            <button onClick={() => restoreMut.mutate()} disabled={restoreMut.isPending}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border border-gray-200 hover:bg-gray-50 text-gray-600 w-full">
              <ArchiveRestore size={10} /> Restore
            </button>
          )}

          {showSchedule && (
            <div className="mt-1 p-2 border border-gray-200 rounded-lg bg-gray-50 space-y-1.5">
              <select value={schedFreq} onChange={(e) => setSchedFreq(e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-1 text-[10px] focus:outline-none">
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
              <input value={schedEmails} onChange={(e) => setSchedEmails(e.target.value)}
                placeholder="email1@co, email2@co"
                className="w-full border border-gray-200 rounded px-2 py-1 text-[10px] focus:outline-none" />
              <button onClick={() => scheduleMut.mutate()} disabled={scheduleMut.isPending || !schedEmails.trim()}
                className="w-full text-[10px] py-1 rounded bg-gray-900 text-white hover:bg-gray-900 disabled:opacity-40">
                Save Schedule
              </button>
            </div>
          )}

          <hr className="border-gray-100 my-1" />

          <button onClick={() => { if (confirm('Delete?')) deleteMut.mutate(); }}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border border-red-100 hover:bg-red-50 text-red-400 w-full">
            <Trash2 size={10} /> Delete
          </button>
        </aside>
      </div>
    </div>
  );
}

/**
 * Renders a report's result payload differently per `report.type`.
 * - TABLE:   the existing table view.
 * - CHART:   bar chart driven by the first string column (X) and first numeric column (Y).
 * - FUNNEL:  recharts funnel using the same column heuristic.
 * - METRIC:  single big-number card pulled from the first numeric cell in the first row.
 * - COHORT:  v1 fallback to TABLE.
 *
 * Unknown/missing data shapes fall back to TABLE so the user still sees *something*.
 */
function ReportResultView({ type, rows }: { type: ReportType; rows: unknown[] }) {
  if (rows.length === 0) {
    return <p className="text-[11px] text-gray-400 text-center py-6">No data returned for this report.</p>;
  }

  const first = rows[0] as Record<string, unknown>;
  const keys = Object.keys(first);
  // Pick the first string-ish column as the label, and the first numeric column as the value.
  const labelKey = keys.find((k) => typeof first[k] === 'string') ?? keys[0];
  const valueKey = keys.find((k) => typeof first[k] === 'number') ?? keys.find((k) => k !== labelKey) ?? keys[0];

  const chartData = rows.slice(0, 50).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      name: String(row[labelKey] ?? ''),
      value: Number(row[valueKey] ?? 0),
    };
  });

  if (type === 'METRIC') {
    const metricVal = Number((first[valueKey] as number | string) ?? 0);
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-widest text-gray-400">{valueKey}</p>
          <p className="text-5xl font-semibold text-gray-900 mt-2 tabular-nums">
            {Number.isFinite(metricVal) ? metricVal.toLocaleString() : String(first[valueKey] ?? '—')}
          </p>
        </div>
      </div>
    );
  }

  if (type === 'CHART') {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-3" style={{ height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={chartData.length > 8 ? -30 : 0} textAnchor={chartData.length > 8 ? 'end' : 'middle'} height={chartData.length > 8 ? 60 : 30} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Bar dataKey="value" fill="#111827" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (type === 'FUNNEL') {
    const palette = ['#111827', '#374151', '#6b7280', '#9ca3af', '#d1d5db', '#e5e7eb'];
    const funnelData = chartData.map((d, i) => ({ ...d, fill: palette[i % palette.length] }));
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-3" style={{ height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <FunnelChart>
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Funnel dataKey="value" data={funnelData} isAnimationActive>
              <LabelList position="right" fill="#374151" stroke="none" dataKey="name" fontSize={11} />
              {funnelData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // TABLE / COHORT / fallback
  return (
    <div className="overflow-auto max-h-[calc(100vh-300px)]">
      <table className="w-full text-[11px]">
        <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
          <tr>
            {keys.slice(0, 8).map((k) => (
              <th key={k} className="text-left px-2 py-1.5 text-[10px] font-medium text-gray-400 uppercase">{k}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50/50">
              {Object.values(row as object).slice(0, 8).map((v, j) => (
                <td key={j} className="px-2 py-1.5 text-gray-600 truncate max-w-[120px]">
                  {v === null ? '—' : String(v).slice(0, 50)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
