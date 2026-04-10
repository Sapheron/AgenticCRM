'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import api from '@/lib/api-client';
import {
  Plus, FileText, Search, Filter, Copy, Archive, Trash2, Power,
  Eye, MessageSquare, CheckCircle2, ChevronDown,
  Tag as TagIcon,
} from 'lucide-react';
import { toast } from 'sonner';

type TemplateStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
type TemplateType = 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO' | 'LOCATION' | 'CONTACTS';
type TemplateCategory = 'GREETING' | 'FOLLOW_UP' | 'PROMOTION' | 'PAYMENT_REMINDER' | 'ORDER_UPDATE' | 'SUPPORT' | 'FEEDBACK' | 'REVIEW' | 'APPOINTMENT' | 'GENERAL';

interface Template {
  id: string;
  name: string;
  category: TemplateCategory;
  type: TemplateType;
  status: TemplateStatus;
  body: string;
  tags: string[];
  useCount: number;
  sentCount: number;
  conversionCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

interface TemplateStats {
  totalTemplates: number;
  activeTemplates: number;
  draftTemplates: number;
  archivedTemplates: number;
  totalUses: number;
}

const STATUS_COLORS: Record<TemplateStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-600 border-gray-200',
  ACTIVE: 'bg-green-50 text-green-700 border-green-200',
  ARCHIVED: 'bg-orange-50 text-orange-700 border-orange-200',
};

const STATUS_ICONS: Record<TemplateStatus, React.ReactNode> = {
  DRAFT: <FileText size={12} />,
  ACTIVE: <CheckCircle2 size={12} />,
  ARCHIVED: <Archive size={12} />,
};

const CATEGORIES: TemplateCategory[] = [
  'GREETING', 'FOLLOW_UP', 'PROMOTION', 'PAYMENT_REMINDER', 'ORDER_UPDATE',
  'SUPPORT', 'FEEDBACK', 'REVIEW', 'APPOINTMENT', 'GENERAL',
];

const TYPES: TemplateType[] = ['TEXT', 'IMAGE', 'DOCUMENT', 'VIDEO', 'LOCATION', 'CONTACTS'];
const STATUSES: TemplateStatus[] = ['DRAFT', 'ACTIVE', 'ARCHIVED'];

export default function TemplatesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<TemplateStatus | ''>('');
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory | ''>('');
  const [selectedType, setSelectedType] = useState<TemplateType | ''>('');
  const [showFilters, setShowFilters] = useState(false);

  // New template form state
  const [newName, setNewName] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newCategory, setNewCategory] = useState<TemplateCategory>('GENERAL');
  const [newType, setNewType] = useState<TemplateType>('TEXT');
  const [newTags, setNewTags] = useState('');

  // Fetch templates with filters
  const { data: templatesData, isLoading } = useQuery({
    queryKey: ['templates', selectedStatus, selectedCategory, selectedType, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedStatus) params.append('status', selectedStatus);
      if (selectedCategory) params.append('category', selectedCategory);
      if (selectedType) params.append('type', selectedType);
      if (search) params.append('search', search);
      const res = await api.get<{ data: { items: Template[]; total: number } }>(`/templates?${params}`);
      return res.data.data;
    },
  });

  // Fetch stats
  const { data: stats } = useQuery({
    queryKey: ['template-stats'],
    queryFn: async () => {
      const res = await api.get<{ data: TemplateStats }>('/templates/stats');
      return res.data.data;
    },
  });

  // Create template mutation
  const createMutation = useMutation({
    mutationFn: () => api.post('/templates', {
      name: newName,
      body: newBody,
      category: newCategory,
      type: newType,
      tags: newTags ? newTags.split(',').map((t) => t.trim()) : [],
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
      void qc.invalidateQueries({ queryKey: ['template-stats'] });
      toast.success('Template created as DRAFT');
      setShowCreate(false);
      setNewName(''); setNewBody(''); setNewCategory('GENERAL');
      setNewType('TEXT'); setNewTags('');
    },
    onError: () => toast.error('Failed to create template'),
  });

  // Quick action mutations
  const activateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/templates/${id}/activate`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
      void qc.invalidateQueries({ queryKey: ['template-stats'] });
      toast.success('Template activated');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/templates/${id}/archive`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
      void qc.invalidateQueries({ queryKey: ['template-stats'] });
      toast.success('Template archived');
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name?: string }) =>
      api.post(`/templates/${id}/duplicate`, { newName: name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
      toast.success('Template duplicated');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/templates/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
      void qc.invalidateQueries({ queryKey: ['template-stats'] });
      toast.success('Template deleted');
    },
    onError: (err: any) => {
      if (err.response?.data?.message?.includes('active')) {
        toast.error('Archive active templates before deleting');
      } else {
        toast.error('Failed to delete template');
      }
    },
  });

  const handleCreate = () => {
    if (!newName.trim() || !newBody.trim()) {
      toast.error('Name and body are required');
      return;
    }
    createMutation.mutate();
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="h-14 border-b border-gray-200 px-5 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-gray-900">Templates</h1>
          {stats && (
            <span className="text-xs text-gray-400">{stats.totalTemplates} total</span>
          )}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
        >
          <Plus size={14} /> New Template
        </button>
      </div>

      {/* Stats Strip */}
      {stats && (
        <div className="grid grid-cols-5 gap-px bg-gray-200 border-b border-gray-200 shrink-0">
          <StatTile label="Total" value={stats.totalTemplates} icon={<FileText size={14} />} />
          <StatTile label="Active" value={stats.activeTemplates} icon={<CheckCircle2 size={14} />} color="text-green-600" />
          <StatTile label="Draft" value={stats.draftTemplates} icon={<FileText size={14} />} color="text-gray-500" />
          <StatTile label="Archived" value={stats.archivedTemplates} icon={<Archive size={14} />} color="text-orange-500" />
          <StatTile label="Total Uses" value={stats.totalUses} icon={<MessageSquare size={14} />} color="text-blue-500" />
        </div>
      )}

      {/* Filters */}
      <div className="px-5 py-3 border-b border-gray-200 bg-white shrink-0 space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates..."
              className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              showFilters || selectedStatus || selectedCategory || selectedType
                ? 'bg-violet-50 border-violet-200 text-violet-700'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Filter size={13} /> Filters
            {(showFilters || selectedStatus || selectedCategory || selectedType) && (
              <span className="ml-1 w-4 h-4 rounded-full bg-violet-200 text-violet-700 flex items-center justify-center text-[10px]">
                {[selectedStatus, selectedCategory, selectedType].filter(Boolean).length}
              </span>
            )}
          </button>
          {(selectedStatus || selectedCategory || selectedType || search) && (
            <button
              onClick={() => {
                setSelectedStatus(''); setSelectedCategory(''); setSelectedType(''); setSearch('');
              }}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Clear all
            </button>
          )}
        </div>

        {showFilters && (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as TemplateStatus | '')}
              className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
            >
              <option value="">All Statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value as TemplateCategory | '')}
              className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
            >
              <option value="">All Categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.replace('_', ' ')}</option>
              ))}
            </select>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as TemplateType | '')}
              className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
            >
              <option value="">All Types</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-12 text-center text-gray-400 text-xs">Loading templates...</div>
        ) : !templatesData?.items?.length ? (
          <div className="p-12 text-center text-gray-400">
            <FileText size={32} className="mx-auto mb-3 text-gray-300" />
            <p className="text-sm">No templates found</p>
            <p className="text-xs mt-1">Create your first template to get started</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider w-1/5">Name</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider w-1/6">Category</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider w-1/4">Body Preview</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider">Status</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider">Usage</th>
                <th className="text-center px-4 py-2.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {templatesData.items.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => router.push(`/templates/${t.id}`)}
                  className="hover:bg-gray-50/80 transition-colors cursor-pointer group"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-900">{t.name}</span>
                      {t.tags.length > 0 && (
                        <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
                          <TagIcon size={10} /> {t.tags.length}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                        t.type === 'TEXT' ? 'bg-gray-50 text-gray-500 border-gray-200' :
                        t.type === 'IMAGE' ? 'bg-blue-50 text-blue-600 border-blue-200' :
                        t.type === 'DOCUMENT' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                        'bg-purple-50 text-purple-600 border-purple-200'
                      }`}>
                        {t.type}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] bg-violet-50 text-violet-600 px-2 py-0.5 rounded-full">
                      {t.category.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 max-w-xs truncate">
                    {t.body.slice(0, 80)}{t.body.length > 80 ? '...' : ''}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium ${STATUS_COLORS[t.status]}`}>
                      {STATUS_ICONS[t.status]}
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="text-xs text-gray-600">{t.useCount} uses</div>
                    {t.conversionCount > 0 && (
                      <div className="text-[10px] text-green-600">{t.conversionCount} converted</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {t.status === 'DRAFT' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); activateMutation.mutate(t.id); }}
                          className="p-1.5 hover:bg-green-50 rounded text-green-600"
                          title="Activate"
                        >
                          <Power size={13} />
                        </button>
                      )}
                      {t.status === 'ACTIVE' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); archiveMutation.mutate(t.id); }}
                          className="p-1.5 hover:bg-orange-50 rounded text-orange-600"
                          title="Archive"
                        >
                          <Archive size={13} />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/templates/${t.id}`);
                        }}
                        className="p-1.5 hover:bg-gray-100 rounded text-gray-500"
                        title="View"
                      >
                        <Eye size={13} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); duplicateMutation.mutate({ id: t.id }); }}
                        className="p-1.5 hover:bg-blue-50 rounded text-blue-600"
                        title="Duplicate"
                      >
                        <Copy size={13} />
                      </button>
                      {(t.status === 'DRAFT' || t.status === 'ARCHIVED') && (
                        <button
                          onClick={(e) => { e.stopPropagation(); if (confirm('Delete this template?')) deleteMutation.mutate(t.id); }}
                          className="p-1.5 hover:bg-red-50 rounded text-red-500"
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      {templatesData && (
        <div className="h-10 border-t border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white text-[10px] text-gray-400">
          <span>{templatesData.total} templates</span>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">New Template</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
                <ChevronDown size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., Welcome Message"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as TemplateCategory)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c.replace('_', ' ')}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as TemplateType)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
                  >
                    {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Body *</label>
                <textarea
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  rows={5}
                  placeholder="Use {{variable}} for personalization, e.g., Hi {{firstName}}, ..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none font-mono"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Variables found: {Array.from(newBody.matchAll(/\{\{(\w+)\}\}/g)).map((m) => m[1]).join(', ') || 'none'}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Tags (comma-separated)</label>
                <input
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  placeholder="e.g., sales, follow-up, urgent"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
                />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={createMutation.isPending || !newName.trim() || !newBody.trim()}
                className="px-4 py-1.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-xs font-medium disabled:opacity-40 transition-colors"
              >
                Create as Draft
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color?: string }) {
  return (
    <div className="bg-white px-4 py-3 flex items-center gap-3">
      <div className={`p-2 rounded-lg bg-gray-50 ${color || 'text-gray-500'}`}>{icon}</div>
      <div>
        <div className={`text-lg font-semibold ${color || 'text-gray-900'}`}>{value.toLocaleString()}</div>
        <div className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</div>
      </div>
    </div>
  );
}
