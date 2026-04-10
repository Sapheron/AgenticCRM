'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import api from '@/lib/api-client';
import {
  Plus,
  GitBranch,
  Search,
  MoreVertical,
  Play,
  Pause,
  Archive,
  Copy,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

interface Sequence {
  id: string;
  name: string;
  description: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  steps: { id: string }[];
  useCount: number;
  completionCount: number;
  avgCompletionTime: number | null;
  tags: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

interface SequenceStats {
  totalSequences: number;
  activeSequences: number;
  totalEnrollments: number;
  activeEnrollments: number;
  overallCompletionRate: number;
}

const STATUS_COLORS = {
  DRAFT: 'bg-gray-100 text-gray-600',
  ACTIVE: 'bg-emerald-50 text-emerald-600',
  PAUSED: 'bg-yellow-50 text-yellow-600',
  ARCHIVED: 'bg-orange-50 text-orange-600',
};

export default function SequencesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  // Fetch stats
  const { data: stats } = useQuery({
    queryKey: ['sequences', 'stats'],
    queryFn: async () => {
      const res = await api.get<{ data: SequenceStats }>('/sequences/stats');
      return res.data.data;
    },
  });

  // Fetch sequences
  const { data, isLoading } = useQuery({
    queryKey: ['sequences', statusFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (search) params.set('search', search);
      const res = await api.get<{ data: { items: Sequence[]; total: number } }>(`/sequences?${params}`);
      return res.data.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/sequences', { name, description: '', tags: [] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sequences'] });
      toast.success('DRAFT sequence created');
      setShowForm(false);
      setName('');
    },
    onError: () => toast.error('Failed to create sequence'),
  });

  // Mutations for sequence actions
  const activateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/sequences/${id}/activate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sequences'] });
      qc.invalidateQueries({ queryKey: ['sequences', 'stats'] });
      toast.success('Sequence activated');
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (id: string) => api.post(`/sequences/${id}/pause`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sequences'] });
      qc.invalidateQueries({ queryKey: ['sequences', 'stats'] });
      toast.success('Sequence paused');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/sequences/${id}/archive`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sequences'] });
      qc.invalidateQueries({ queryKey: ['sequences', 'stats'] });
      toast.success('Sequence archived');
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/sequences/${id}/duplicate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sequences'] });
      qc.invalidateQueries({ queryKey: ['sequences', 'stats'] });
      toast.success('Sequence duplicated');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/sequences/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sequences'] });
      qc.invalidateQueries({ queryKey: ['sequences', 'stats'] });
      toast.success('Sequence deleted');
    },
  });

  const handleAction = (id: string, action: string) => {
    setMenuOpen(null);
    switch (action) {
      case 'activate':
        activateMutation.mutate(id);
        break;
      case 'pause':
        pauseMutation.mutate(id);
        break;
      case 'archive':
        archiveMutation.mutate(id);
        break;
      case 'duplicate':
        duplicateMutation.mutate(id);
        break;
      case 'delete':
        if (confirm('Delete this sequence?')) {
          deleteMutation.mutate(id);
        }
        break;
      case 'enroll':
        router.push(`/sequences/${id}`);
        break;
    }
  };

  const completionRate = (seq: Sequence) => {
    if (seq.useCount === 0) return 0;
    return Math.round((seq.completionCount / seq.useCount) * 100);
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="h-14 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <div>
          <h1 className="text-sm font-semibold text-gray-900">Sequences</h1>
          <p className="text-[11px] text-gray-400 mt-0.5">Automated drip campaigns & follow-ups</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
        >
          <Plus size={14} /> Create Sequence
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="border-b border-gray-200 bg-white p-4 space-y-3 shrink-0">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sequence name (required)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={() => createMutation.mutate()}
              disabled={!name || createMutation.isPending}
              className="bg-gray-900 text-white px-4 py-2 rounded-lg text-xs font-medium disabled:opacity-30 hover:bg-gray-800 transition-colors"
            >
              Create as Draft
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                setName('');
              }}
              className="text-gray-400 text-xs px-3 py-2 hover:text-gray-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Stats Strip */}
      {stats && (
        <div className="grid grid-cols-5 gap-3 px-4 py-3 border-b border-gray-200 bg-white shrink-0">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Total</div>
            <div className="text-lg font-semibold text-gray-900 mt-1">{stats.totalSequences}</div>
          </div>
          <div className="bg-emerald-50 rounded-lg p-3">
            <div className="text-[10px] text-emerald-600 uppercase tracking-wider font-medium">Active</div>
            <div className="text-lg font-semibold text-emerald-700 mt-1">{stats.activeSequences}</div>
          </div>
          <div className="bg-blue-50 rounded-lg p-3">
            <div className="text-[10px] text-blue-600 uppercase tracking-wider font-medium">Enrollments</div>
            <div className="text-lg font-semibold text-blue-700 mt-1">{stats.totalEnrollments}</div>
          </div>
          <div className="bg-violet-50 rounded-lg p-3">
            <div className="text-[10px] text-violet-600 uppercase tracking-wider font-medium">Completion</div>
            <div className="text-lg font-semibold text-violet-700 mt-1">{Math.round(stats.overallCompletionRate * 100)}%</div>
          </div>
          <div className="bg-orange-50 rounded-lg p-3">
            <div className="text-[10px] text-orange-600 uppercase tracking-wider font-medium">Active Enroll</div>
            <div className="text-lg font-semibold text-orange-700 mt-1">{stats.activeEnrollments}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="h-12 border-b border-gray-200 px-4 flex items-center gap-3 shrink-0 bg-white">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sequences..."
            className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
        >
          <option value="">All Status</option>
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
          <option value="PAUSED">Paused</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-12 text-center text-gray-400 text-xs">Loading sequences...</div>
        ) : !data?.items?.length ? (
          <div className="p-12 text-center text-gray-400">
            <GitBranch size={32} className="mx-auto mb-3 text-gray-300" />
            <p className="text-sm font-medium">No sequences yet</p>
            <p className="text-xs mt-1">Create your first automated drip campaign</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider">Steps</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider">Enrollments</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider">Completion</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider">Avg Time</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider">Tags</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {data.items.map((s) => (
                <tr
                  key={s.id}
                  className="hover:bg-gray-50/50 transition-colors cursor-pointer group"
                  onClick={() => router.push(`/sequences/${s.id}`)}
                >
                  <td className="px-4 py-3">
                    <div className="text-xs font-medium text-gray-900">{s.name}</div>
                    {s.description && (
                      <div className="text-[10px] text-gray-400 mt-0.5 line-clamp-1">{s.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[s.status]}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{s.steps.length} steps</td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-gray-900">{s.useCount}</div>
                    {s.lastUsedAt && (
                      <div className="text-[10px] text-gray-400">
                        last: {new Date(s.lastUsedAt).toLocaleDateString()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="text-xs text-gray-900">{completionRate(s)}%</div>
                      <div className="flex-1 w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all"
                          style={{ width: `${completionRate(s)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {s.avgCompletionTime ? `${Math.round(s.avgCompletionTime)}h` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {s.tags.slice(0, 2).map((tag) => (
                        <span key={tag} className="text-[9px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                          {tag}
                        </span>
                      ))}
                      {s.tags.length > 2 && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-gray-50 text-gray-400 rounded">
                          +{s.tags.length - 2}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="relative flex items-center justify-end gap-1">
                      {s.status === 'ACTIVE' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAction(s.id, 'enroll');
                          }}
                          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                          title="Enroll contacts"
                        >
                          <Users size={13} className="text-gray-400" />
                        </button>
                      )}
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpen(menuOpen === s.id ? null : s.id);
                          }}
                          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          <MoreVertical size={13} className="text-gray-400" />
                        </button>
                        {menuOpen === s.id && (
                          <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-100 py-1 z-10">
                            {s.status === 'DRAFT' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAction(s.id, 'activate');
                                }}
                                className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 flex items-center gap-2"
                              >
                                <Play size={12} className="text-emerald-500" /> Activate
                              </button>
                            )}
                            {s.status === 'ACTIVE' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAction(s.id, 'pause');
                                }}
                                className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 flex items-center gap-2"
                              >
                                <Pause size={12} className="text-yellow-500" /> Pause
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAction(s.id, 'duplicate');
                              }}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 flex items-center gap-2"
                            >
                              <Copy size={12} className="text-gray-400" /> Duplicate
                            </button>
                            {(s.status === 'DRAFT' || s.status === 'PAUSED') && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAction(s.id, 'archive');
                                }}
                                className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 flex items-center gap-2"
                              >
                                <Archive size={12} className="text-orange-400" /> Archive
                              </button>
                            )}
                            {(s.status === 'DRAFT' || s.status === 'ARCHIVED') && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAction(s.id, 'delete');
                                }}
                                className="w-full px-3 py-1.5 text-left text-xs hover:bg-red-50 text-red-600 flex items-center gap-2"
                              >
                                <Trash2 size={12} /> Delete
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      {data && (
        <div className="h-10 border-t border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white text-[10px] text-gray-400">
          <span>{data.total} sequence{data.total !== 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  );
}
