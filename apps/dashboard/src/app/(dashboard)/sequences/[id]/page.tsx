'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from '@tanstack/react-router';
import api from '@/lib/api-client';
import {
  ArrowLeft,
  Play,
  Pause,
  Archive,
  Copy,
  Trash2,
  Users,
  Clock,
  XCircle,
  MoreVertical,
  Calendar,
  BarChart3,
} from 'lucide-react';
import { toast } from 'sonner';

interface SequenceStep {
  id: string;
  sortOrder: number;
  delayHours: number;
  action: string;
  message: string | null;
  templateId: string | null;
  tagName: string | null;
  condition: string | null;
}

interface Sequence {
  id: string;
  name: string;
  description: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  steps: SequenceStep[];
  useCount: number;
  completionCount: number;
  avgCompletionTime: number | null;
  tags: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

interface Enrollment {
  id: string;
  contact: {
    id: string;
    displayName: string;
    firstName: string | null;
    lastName: string | null;
    phoneNumber: string;
    email: string | null;
  };
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'STOPPED' | 'CANCELLED';
  currentStep: number;
  enrolledAt: string;
  nextRunAt: string | null;
  completedAt: string | null;
}

interface Activity {
  id: string;
  type: string;
  title: string;
  body: string | null;
  createdAt: string;
  actorType: string;
}

const STATUS_COLORS = {
  DRAFT: 'bg-gray-100 text-gray-600',
  ACTIVE: 'bg-emerald-50 text-emerald-600',
  PAUSED: 'bg-yellow-50 text-yellow-600',
  ARCHIVED: 'bg-orange-50 text-orange-600',
};

const ENROLLMENT_STATUS_COLORS = {
  ACTIVE: 'bg-blue-50 text-blue-600',
  PAUSED: 'bg-yellow-50 text-yellow-600',
  COMPLETED: 'bg-emerald-50 text-emerald-600',
  STOPPED: 'bg-red-50 text-red-600',
  CANCELLED: 'bg-gray-50 text-gray-500',
};

const ACTION_LABELS: Record<string, string> = {
  send_message: 'Send Message',
  send_email: 'Send Email',
  wait: 'Wait',
  add_tag: 'Add Tag',
  remove_tag: 'Remove Tag',
  webhook: 'Webhook',
  ai_task: 'AI Task',
};

export default function SequenceDetailPage() {
  const { id } = useParams({ strict: false });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'steps' | 'enrollments' | 'activity'>('steps');
  const [enrollMenuOpen, setEnrollMenuOpen] = useState<string | null>(null);

  const { data: sequence, isLoading } = useQuery({
    queryKey: ['sequence', id],
    queryFn: async () => {
      const res = await api.get<{ data: Sequence }>(`/sequences/${id}`);
      return res.data.data;
    },
    enabled: !!id,
  });

  const { data: enrollments } = useQuery({
    queryKey: ['sequence-enrollments', id],
    queryFn: async () => {
      const res = await api.get<{ data: Enrollment[] }>(`/sequences/${id}/enrollments`);
      return res.data.data;
    },
    enabled: !!id && activeTab === 'enrollments',
  });

  const { data: activities } = useQuery({
    queryKey: ['sequence-activity', id],
    queryFn: async () => {
      const res = await api.get<{ data: Activity[] }>(`/sequences/${id}/timeline?limit=50`);
      return res.data.data;
    },
    enabled: !!id && activeTab === 'activity',
  });

  const activateMutation = useMutation({
    mutationFn: () => api.post(`/sequences/${id}/activate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sequence', id] });
      toast.success('Sequence activated');
    },
  });

  const pauseMutation = useMutation({
    mutationFn: () => api.post(`/sequences/${id}/pause`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sequence', id] });
      toast.success('Sequence paused');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => api.post(`/sequences/${id}/archive`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sequence', id] });
      toast.success('Sequence archived');
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: () => api.post(`/sequences/${id}/duplicate`),
    onSuccess: () => {
      navigate({ to: '/sequences' });
      toast.success('Sequence duplicated');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/sequences/${id}`),
    onSuccess: () => {
      navigate({ to: '/sequences' });
      toast.success('Sequence deleted');
    },
  });

  const pauseEnrollmentMutation = useMutation({
    mutationFn: (enrollmentId: string) => api.post(`/enrollments/${enrollmentId}/pause`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sequence-enrollments', id] });
      toast.success('Enrollment paused');
    },
  });

  const resumeEnrollmentMutation = useMutation({
    mutationFn: (enrollmentId: string) => api.post(`/enrollments/${enrollmentId}/resume`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sequence-enrollments', id] });
      toast.success('Enrollment resumed');
    },
  });

  const stopEnrollmentMutation = useMutation({
    mutationFn: (enrollmentId: string) => api.post(`/enrollments/${enrollmentId}/stop`, { reason: 'Stopped manually' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sequence-enrollments', id] });
      toast.success('Enrollment stopped');
    },
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading sequence...</div>
      </div>
    );
  }

  if (!sequence) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-gray-400 text-sm">Sequence not found</div>
      </div>
    );
  }

  const completionRate = sequence.useCount > 0 ? Math.round((sequence.completionCount / sequence.useCount) * 100) : 0;

  const handleEnrollmentAction = (enrollmentId: string, action: string) => {
    setEnrollMenuOpen(null);
    switch (action) {
      case 'pause':
        pauseEnrollmentMutation.mutate(enrollmentId);
        break;
      case 'resume':
        resumeEnrollmentMutation.mutate(enrollmentId);
        break;
      case 'stop':
        if (confirm('Stop this enrollment?')) {
          stopEnrollmentMutation.mutate(enrollmentId);
        }
        break;
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="h-14 border-b border-gray-200 px-4 flex items-center gap-3 shrink-0 bg-white">
        <button
          onClick={() => navigate({ to: '/sequences' })}
          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft size={16} className="text-gray-400" />
        </button>
        <div className="flex-1">
          <h1 className="text-sm font-semibold text-gray-900">{sequence.name}</h1>
          <p className="text-[10px] text-gray-400 mt-0.5">
            {sequence.steps.length} steps · {sequence.useCount} enrollments
          </p>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[sequence.status]}`}>
          {sequence.status}
        </span>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Info */}
        <div className="w-72 border-r border-gray-200 bg-white overflow-auto">
          <div className="p-4 space-y-4">
            {/* Description */}
            {sequence.description && (
              <div>
                <h3 className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-2">Description</h3>
                <p className="text-xs text-gray-600">{sequence.description}</p>
              </div>
            )}

            {/* Stats */}
            <div>
              <h3 className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-2">Performance</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Enrollments</span>
                  <span className="text-xs font-medium text-gray-900">{sequence.useCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Completed</span>
                  <span className="text-xs font-medium text-gray-900">{sequence.completionCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Completion Rate</span>
                  <span className="text-xs font-medium text-emerald-600">{completionRate}%</span>
                </div>
                {sequence.avgCompletionTime && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Avg Time</span>
                    <span className="text-xs font-medium text-gray-900">{Math.round(sequence.avgCompletionTime)}h</span>
                  </div>
                )}
              </div>
            </div>

            {/* Tags */}
            {sequence.tags.length > 0 && (
              <div>
                <h3 className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-2">Tags</h3>
                <div className="flex flex-wrap gap-1.5">
                  {sequence.tags.map((tag) => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Metadata */}
            <div>
              <h3 className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-2">Metadata</h3>
              <div className="space-y-1.5 text-xs text-gray-500">
                <div className="flex items-center gap-2">
                  <Calendar size={11} />
                  Created {new Date(sequence.createdAt).toLocaleDateString()}
                </div>
                {sequence.lastUsedAt && (
                  <div className="flex items-center gap-2">
                    <Clock size={11} />
                    Last used {new Date(sequence.lastUsedAt).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Center Panel - Tabs */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="h-11 border-b border-gray-200 bg-white px-4 flex items-center gap-4 shrink-0">
            <button
              onClick={() => setActiveTab('steps')}
              className={`text-xs font-medium pb-2 border-b-2 transition-colors ${
                activeTab === 'steps'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              Steps ({sequence.steps.length})
            </button>
            <button
              onClick={() => setActiveTab('enrollments')}
              className={`text-xs font-medium pb-2 border-b-2 transition-colors ${
                activeTab === 'enrollments'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              Enrollments {sequence.useCount > 0 && `(${sequence.useCount})`}
            </button>
            <button
              onClick={() => setActiveTab('activity')}
              className={`text-xs font-medium pb-2 border-b-2 transition-colors ${
                activeTab === 'activity'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              Activity
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-auto p-4">
            {activeTab === 'steps' && (
              <div className="space-y-3">
                {sequence.steps.map((step, index) => (
                  <div
                    key={step.id}
                    className="bg-white rounded-lg border border-gray-200 p-3 hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-[10px] font-medium shrink-0">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-gray-900">{ACTION_LABELS[step.action] || step.action}</span>
                          <span className="text-[10px] text-gray-400">
                            +{step.delayHours}h
                            {index > 0 && ` after step ${index}`}
                          </span>
                        </div>
                        {step.message && (
                          <p className="text-xs text-gray-600 line-clamp-2 mt-1">{step.message}</p>
                        )}
                        {step.templateId && (
                          <p className="text-[10px] text-violet-600 mt-1">Using template</p>
                        )}
                        {step.tagName && (
                          <p className="text-[10px] text-gray-500 mt-1">Tag: {step.tagName}</p>
                        )}
                        {step.condition && (
                          <p className="text-[10px] text-yellow-600 mt-1">Condition: {step.condition}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {sequence.steps.length === 0 && (
                  <div className="text-center py-8 text-gray-400 text-xs">No steps added yet</div>
                )}
              </div>
            )}

            {activeTab === 'enrollments' && (
              <div className="space-y-2">
                {enrollments?.map((enrollment) => (
                  <div
                    key={enrollment.id}
                    className="bg-white rounded-lg border border-gray-200 p-3 hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-900">
                            {enrollment.contact.displayName || enrollment.contact.phoneNumber}
                          </span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${ENROLLMENT_STATUS_COLORS[enrollment.status]}`}>
                            {enrollment.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-400">
                          <span>Step {enrollment.currentStep + 1}/{sequence.steps.length}</span>
                          {enrollment.nextRunAt && (
                            <span>Next: {new Date(enrollment.nextRunAt).toLocaleString()}</span>
                          )}
                        </div>
                      </div>
                      <div className="relative">
                        <button
                          onClick={() => setEnrollMenuOpen(enrollMenuOpen === enrollment.id ? null : enrollment.id)}
                          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          <MoreVertical size={13} className="text-gray-400" />
                        </button>
                        {enrollMenuOpen === enrollment.id && (
                          <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-lg shadow-lg border border-gray-100 py-1 z-10">
                            {enrollment.status === 'ACTIVE' && (
                              <button
                                onClick={() => handleEnrollmentAction(enrollment.id, 'pause')}
                                className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 flex items-center gap-2"
                              >
                                <Pause size={12} className="text-yellow-500" /> Pause
                              </button>
                            )}
                            {enrollment.status === 'PAUSED' && (
                              <button
                                onClick={() => handleEnrollmentAction(enrollment.id, 'resume')}
                                className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 flex items-center gap-2"
                              >
                                <Play size={12} className="text-emerald-500" /> Resume
                              </button>
                            )}
                            {(enrollment.status === 'ACTIVE' || enrollment.status === 'PAUSED') && (
                              <button
                                onClick={() => handleEnrollmentAction(enrollment.id, 'stop')}
                                className="w-full px-3 py-1.5 text-left text-xs hover:bg-red-50 text-red-600 flex items-center gap-2"
                              >
                                <XCircle size={12} /> Stop
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {!enrollments?.length && (
                  <div className="text-center py-8 text-gray-400 text-xs">No enrollments yet</div>
                )}
              </div>
            )}

            {activeTab === 'activity' && (
              <div className="space-y-3">
                {activities?.map((activity) => (
                  <div key={activity.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-2 h-2 rounded-full bg-gray-300 mt-1.5" />
                      <div className="w-0.5 flex-1 bg-gray-100 mt-1" />
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-900">{activity.title}</span>
                        <span className="text-[10px] text-gray-400 capitalize">{activity.actorType}</span>
                      </div>
                      {activity.body && (
                        <p className="text-xs text-gray-600 mt-0.5">{activity.body}</p>
                      )}
                      <div className="text-[10px] text-gray-400 mt-1">
                        {new Date(activity.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
                {!activities?.length && (
                  <div className="text-center py-8 text-gray-400 text-xs">No activity yet</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Quick Actions */}
        <div className="w-64 border-l border-gray-200 bg-white p-4 space-y-3 overflow-auto">
          <div>
            <h3 className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-2">Actions</h3>
            <div className="space-y-2">
              {sequence.status === 'DRAFT' && (
                <button
                  onClick={() => activateMutation.mutate()}
                  disabled={activateMutation.isPending}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium transition-colors disabled:opacity-30"
                >
                  <Play size={14} /> Activate
                </button>
              )}
              {sequence.status === 'ACTIVE' && (
                <button
                  onClick={() => pauseMutation.mutate()}
                  disabled={pauseMutation.isPending}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-yellow-50 hover:bg-yellow-100 text-yellow-700 rounded-lg text-xs font-medium transition-colors disabled:opacity-30"
                >
                  <Pause size={14} /> Pause
                </button>
              )}
              {sequence.status === 'ACTIVE' && (
                <button
                  onClick={() => navigate({ to: `/contacts?enrollIn=${sequence.id}` })}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-medium transition-colors"
                >
                  <Users size={14} /> Enroll Contacts
                </button>
              )}
              <button
                onClick={() => duplicateMutation.mutate()}
                disabled={duplicateMutation.isPending}
                className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-lg text-xs font-medium transition-colors disabled:opacity-30"
              >
                <Copy size={14} /> Duplicate
              </button>
              {(sequence.status === 'DRAFT' || sequence.status === 'PAUSED') && (
                <button
                  onClick={() => archiveMutation.mutate()}
                  disabled={archiveMutation.isPending}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-orange-50 hover:bg-orange-100 text-orange-700 rounded-lg text-xs font-medium transition-colors disabled:opacity-30"
                >
                  <Archive size={14} /> Archive
                </button>
              )}
              {(sequence.status === 'DRAFT' || sequence.status === 'ARCHIVED') && (
                <button
                  onClick={() => {
                    if (confirm('Delete this sequence? This cannot be undone.')) {
                      deleteMutation.mutate();
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-medium transition-colors disabled:opacity-30"
                >
                  <Trash2 size={14} /> Delete
                </button>
              )}
            </div>
          </div>

          <div className="border-t border-gray-100 pt-3">
            <h3 className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-2">Analytics</h3>
            <button
              onClick={() => navigate({ to: `/analytics?sequence=${sequence.id}` })}
              className="w-full flex items-center gap-2 px-3 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-lg text-xs font-medium transition-colors"
            >
              <BarChart3 size={14} /> View Performance
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
