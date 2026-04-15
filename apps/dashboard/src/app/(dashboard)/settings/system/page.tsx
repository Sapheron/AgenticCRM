'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import {
  ArrowLeft, RefreshCw, ArrowUpCircle, CheckCircle2, XCircle,
  Clock, GitCommit, Loader2, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface VersionInfo {
  version: string;
  commitHash: string;
  commitDate: string;
  branch: string;
}

interface UpdateCheck {
  current: VersionInfo;
  latest: {
    commitHash: string;
    commitDate: string;
    message: string;
    author: string;
  } | null;
  updateAvailable: boolean;
  checkedAt: string;
}

interface UpdateStatus {
  isUpdating: boolean;
  lastUpdate: {
    startedAt: string;
    completedAt?: string;
    success: boolean;
    log: string;
  } | null;
}

interface ChangelogEntry {
  hash: string;
  date: string;
  message: string;
  author: string;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SystemSettingsPage() {
  const qc = useQueryClient();
  const [showLog, setShowLog] = useState(false);

  const { data: updateCheck, isLoading: checking, refetch: recheckUpdate } = useQuery<UpdateCheck>({
    queryKey: ['system-update-check'],
    queryFn: () => api.get('/system/check-update').then((r) => r.data.data),
  });

  const { data: updateStatus, refetch: refetchStatus } = useQuery<UpdateStatus>({
    queryKey: ['system-update-status'],
    queryFn: () => api.get('/system/update-status').then((r) => r.data.data),
    // Poll every 2s while updating (for live log), every 5s when update available, otherwise stop
    refetchInterval: (query) => {
      const status = query.state.data;
      if (status?.isUpdating) return 2000;
      if (updateCheck?.updateAvailable) return 5000;
      return false;
    },
  });

  const { data: changelog } = useQuery<ChangelogEntry[]>({
    queryKey: ['system-changelog'],
    queryFn: () => api.get('/system/changelog').then((r) => r.data.data),
    enabled: !!updateCheck?.updateAvailable,
  });

  const updateMut = useMutation({
    mutationFn: () => api.post('/system/update'),
    onSuccess: (res) => {
      toast.success(res.data.data?.message || res.data.message || 'Update started');
      void qc.invalidateQueries({ queryKey: ['system-update-status'] });
    },
    onError: () => toast.error('Failed to start update'),
  });

  const current = updateCheck?.current;
  const latest = updateCheck?.latest;
  const isUpdating = updateStatus?.isUpdating;
  const logRef = useRef<HTMLPreElement>(null);

  // Auto-show log and auto-scroll when updating
  useEffect(() => {
    if (isUpdating) setShowLog(true);
  }, [isUpdating]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [updateStatus?.lastUpdate?.log]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center gap-3 shrink-0 bg-white">
        <Link href="/settings" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={14} />
        </Link>
        <span className="text-xs font-semibold text-gray-900">System & Updates</span>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4 max-w-3xl">

        {/* Current Version */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-gray-900 mb-3">Current Version</h3>
          {current ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <InfoCard label="Version" value={`v${current.version}`} />
              <InfoCard label="Commit" value={current.commitHash} />
              <InfoCard label="Branch" value={current.branch} />
              <InfoCard label="Built" value={new Date(current.commitDate).toLocaleDateString()} />
            </div>
          ) : checking ? (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 size={12} className="animate-spin" /> Loading...
            </div>
          ) : (
            <p className="text-xs text-gray-400">Unable to fetch version info</p>
          )}
        </div>

        {/* Update Status */}
        <div className={cn(
          'border rounded-lg p-4',
          updateCheck?.updateAvailable
            ? 'bg-gray-50 border-gray-200'
            : 'bg-white border-gray-200',
        )}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-gray-900 flex items-center gap-2">
              {updateCheck?.updateAvailable ? (
                <>
                  <ArrowUpCircle size={14} className="text-gray-800" />
                  Update Available
                </>
              ) : (
                <>
                  <CheckCircle2 size={14} className="text-green-500" />
                  Up to Date
                </>
              )}
            </h3>
            <button
              onClick={() => recheckUpdate()}
              disabled={checking}
              className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-700 disabled:opacity-40"
            >
              <RefreshCw size={11} className={cn(checking && 'animate-spin')} />
              Check Now
            </button>
          </div>

          {updateCheck?.updateAvailable && latest && (
            <div className="space-y-3">
              <div className="bg-white/80 rounded-md p-3 space-y-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <GitCommit size={12} className="text-gray-800 shrink-0" />
                  <span className="font-medium text-gray-900">{latest.message}</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-gray-400 pl-5">
                  <span>{latest.commitHash}</span>
                  <span>by {latest.author}</span>
                  <span>{new Date(latest.commitDate).toLocaleString()}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateMut.mutate()}
                  disabled={isUpdating || updateMut.isPending}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
                    isUpdating || updateMut.isPending
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-gray-900 text-white hover:bg-gray-900',
                  )}
                >
                  {isUpdating ? (
                    <><Loader2 size={12} className="animate-spin" /> Updating...</>
                  ) : (
                    <><ArrowUpCircle size={12} /> Update Now</>
                  )}
                </button>

                {updateCheck.checkedAt && (
                  <span className="text-[10px] text-gray-400 flex items-center gap-1">
                    <Clock size={10} />
                    Last checked {new Date(updateCheck.checkedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          )}

          {!updateCheck?.updateAvailable && updateCheck?.checkedAt && (
            <p className="text-[11px] text-gray-400 flex items-center gap-1">
              <Clock size={10} />
              Last checked {new Date(updateCheck.checkedAt).toLocaleTimeString()}
            </p>
          )}
        </div>

        {/* Update Progress / Last Update Log */}
        {updateStatus?.lastUpdate && (
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-900 flex items-center gap-2">
                {isUpdating ? (
                  <><Loader2 size={14} className="animate-spin text-gray-800" /> Update in Progress</>
                ) : updateStatus.lastUpdate.success ? (
                  <><CheckCircle2 size={14} className="text-green-500" /> Last Update Succeeded</>
                ) : (
                  <><XCircle size={14} className="text-red-500" /> Last Update Failed</>
                )}
              </h3>
              <button
                onClick={() => { setShowLog(!showLog); void refetchStatus(); }}
                className="text-[11px] text-gray-500 hover:text-gray-700"
              >
                {showLog ? 'Hide Log' : 'Show Log'}
              </button>
            </div>

            <div className="flex items-center gap-4 text-[10px] text-gray-400">
              <span>Started: {new Date(updateStatus.lastUpdate.startedAt).toLocaleString()}</span>
              {updateStatus.lastUpdate.completedAt && (
                <span>Completed: {new Date(updateStatus.lastUpdate.completedAt).toLocaleString()}</span>
              )}
            </div>

            {showLog && (
              <pre ref={logRef} className="mt-3 bg-gray-900 text-gray-300 text-[10px] p-3 rounded-md overflow-x-auto max-h-80 overflow-y-auto font-mono leading-relaxed whitespace-pre-wrap">
                {updateStatus.lastUpdate.log || 'Waiting for output...'}
              </pre>
            )}
          </div>
        )}

        {/* Changelog */}
        {changelog && changelog.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-xs font-semibold text-gray-900 mb-3">
              Changelog ({changelog.length} new commit{changelog.length > 1 ? 's' : ''})
            </h3>
            <div className="space-y-2">
              {changelog.map((entry) => (
                <div key={entry.hash} className="flex items-start gap-2.5 py-1.5 border-b border-gray-100 last:border-0">
                  <div className="w-5 h-5 rounded bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                    <GitCommit size={10} className="text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-900 truncate">{entry.message}</p>
                    <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                      <code className="bg-gray-50 px-1 rounded">{entry.hash}</code>
                      <span>{entry.author}</span>
                      <span>{new Date(entry.date).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Warning */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2.5">
          <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="text-[11px] text-amber-700 space-y-1">
            <p className="font-medium">Before updating</p>
            <p>Updates will pull the latest code, rebuild Docker containers, run database migrations, and restart all services. There will be a brief downtime during the restart.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-md px-3 py-2">
      <p className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</p>
      <p className="text-xs font-medium text-gray-900 mt-0.5 font-mono">{value}</p>
    </div>
  );
}
