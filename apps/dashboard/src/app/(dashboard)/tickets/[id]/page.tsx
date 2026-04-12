'use client';

/**
 * Ticket detail — 3-column Linear layout.
 *
 * Left:   metadata (status, priority, category, source, SLA, contact, assignee)
 * Center: tabs — Comments / Activity / Notes
 * Right:  actions — assign / escalate / change status / merge / delete
 */

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { cn, formatRelativeTime } from '@/lib/utils';
import {
  ArrowLeft,
  Check,
  XCircle,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  LifeBuoy,
  MessageSquare,
  Clock,
  ArrowUpCircle,
  UserPlus,
  GitMerge,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface TicketComment {
  id: string;
  authorId: string | null;
  authorType: string;
  content: string;
  isInternal: boolean;
  createdAt: string;
}

interface Ticket {
  id: string;
  ticketNumber: string;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  category: string | null;
  source: string;
  contactId: string | null;
  assignedToId: string | null;
  tags: string[];
  slaPolicyId: string | null;
  slaFirstResponseDue: string | null;
  slaResolutionDue: string | null;
  slaFirstResponseBreached: boolean;
  slaResolutionBreached: boolean;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  escalatedAt: string | null;
  mergedIntoId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  comments: TicketComment[];
  activities?: Array<{
    id: string;
    type: string;
    title: string;
    body: string | null;
    actorType: string;
    createdAt: string;
  }>;
}

const STATUS_COLORS: Record<TicketStatus, string> = {
  OPEN: 'bg-blue-50 text-blue-600',
  IN_PROGRESS: 'bg-violet-50 text-violet-700',
  WAITING: 'bg-amber-50 text-amber-600',
  ESCALATED: 'bg-red-50 text-red-600',
  RESOLVED: 'bg-emerald-50 text-emerald-700',
  CLOSED: 'bg-gray-50 text-gray-400',
};

const PRIORITY_COLORS: Record<TicketPriority, string> = {
  LOW: 'text-gray-400',
  MEDIUM: 'text-blue-600',
  HIGH: 'text-amber-600',
  CRITICAL: 'text-red-600',
};

export default function TicketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const id = params.id as string;

  const [tab, setTab] = useState<'comments' | 'activity' | 'notes'>('comments');
  const [commentDraft, setCommentDraft] = useState('');
  const [commentInternal, setCommentInternal] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: async () => {
      const r = await api.get<{ data: Ticket }>(`/tickets/${id}`);
      return r.data.data;
    },
  });

  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['ticket', id] }); };
  const onErr = (err: unknown) => {
    const msg = err && typeof err === 'object' && 'response' in err
      ? (err as { response?: { data?: { message?: string } } }).response?.data?.message : null;
    toast.error(msg ?? 'Failed');
  };

  const changeStatusM = useMutation({
    mutationFn: (body: { status: string; reason?: string }) => api.post(`/tickets/${id}/status`, body),
    onSuccess: () => { invalidate(); toast.success('Status changed'); },
    onError: onErr,
  });
  const assignM = useMutation({
    mutationFn: (assignedToId: string | null) => api.post(`/tickets/${id}/assign`, { assignedToId }),
    onSuccess: () => { invalidate(); toast.success('Assigned'); },
    onError: onErr,
  });
  const escalateM = useMutation({
    mutationFn: (reason: string) => api.post(`/tickets/${id}/escalate`, { reason }),
    onSuccess: () => { invalidate(); toast.success('Escalated'); },
    onError: onErr,
  });
  const mergeM = useMutation({
    mutationFn: (targetTicketId: string) => api.post(`/tickets/${id}/merge`, { targetTicketId }),
    onSuccess: () => { invalidate(); toast.success('Merged'); },
    onError: onErr,
  });
  const deleteM = useMutation({
    mutationFn: () => api.delete(`/tickets/${id}`),
    onSuccess: () => { toast.success('Deleted'); router.push('/tickets'); },
    onError: onErr,
  });
  const addCommentM = useMutation({
    mutationFn: () => api.post(`/tickets/${id}/comments`, { content: commentDraft, isInternal: commentInternal }),
    onSuccess: () => { invalidate(); setCommentDraft(''); toast.success('Comment added'); },
    onError: onErr,
  });
  const addNoteM = useMutation({
    mutationFn: () => api.post(`/tickets/${id}/notes`, { body: noteDraft }),
    onSuccess: () => { invalidate(); setNoteDraft(''); toast.success('Note added'); },
  });

  if (isLoading) return <div className="h-full flex items-center justify-center"><p className="text-gray-300 text-xs">Loading…</p></div>;
  if (!ticket) return <div className="h-full flex items-center justify-center"><p className="text-gray-300 text-xs">Ticket not found</p></div>;

  const breached = ticket.slaFirstResponseBreached || ticket.slaResolutionBreached;
  const isTerminal = ticket.status === 'RESOLVED' || ticket.status === 'CLOSED';

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 border-b border-gray-200 px-4 flex items-center gap-3 shrink-0 bg-white">
        <Link href="/tickets" className="text-gray-400 hover:text-gray-600"><ArrowLeft size={14} /></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xs font-semibold text-gray-900 truncate font-mono">{ticket.ticketNumber}</h1>
          <p className="text-[10px] text-gray-400 truncate">{ticket.title}</p>
        </div>
        <span className={cn('text-[10px] px-2 py-0.5 rounded font-medium', STATUS_COLORS[ticket.status])}>{ticket.status}</span>
        {breached && <span className="flex items-center gap-1 text-[9px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded"><AlertTriangle size={9} /> SLA</span>}
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Left panel */}
        <aside className="w-64 border-r border-gray-200 bg-white overflow-auto shrink-0">
          <div className="p-3 space-y-4">
            <Section title="Details">
              <Row label="Priority" value={<span className={cn('font-medium', PRIORITY_COLORS[ticket.priority])}>{ticket.priority}</span>} />
              <Row label="Category" value={ticket.category ?? 'general'} />
              <Row label="Source" value={ticket.source} />
              {ticket.assignedToId ? (
                <Row label="Assigned" value={<code className="text-[9px]">{ticket.assignedToId.slice(0, 10)}…</code>} />
              ) : (
                <Row label="Assigned" value={<span className="text-gray-300">Unassigned</span>} />
              )}
            </Section>

            {ticket.slaPolicyId && (
              <Section title="SLA">
                {ticket.slaFirstResponseDue && (
                  <Row label="1st response" value={
                    <span className={ticket.slaFirstResponseBreached ? 'text-red-600 font-medium' : ''}>
                      {ticket.firstResponseAt ? formatRelativeTime(ticket.firstResponseAt) : new Date(ticket.slaFirstResponseDue).toLocaleString()}
                      {ticket.slaFirstResponseBreached && ' BREACHED'}
                    </span>
                  } />
                )}
                {ticket.slaResolutionDue && (
                  <Row label="Resolution" value={
                    <span className={ticket.slaResolutionBreached ? 'text-red-600 font-medium' : ''}>
                      {ticket.resolvedAt ? formatRelativeTime(ticket.resolvedAt) : new Date(ticket.slaResolutionDue).toLocaleString()}
                      {ticket.slaResolutionBreached && ' BREACHED'}
                    </span>
                  } />
                )}
              </Section>
            )}

            <Section title="Linked">
              {ticket.contactId ? (
                <Link href={`/contacts/${ticket.contactId}`} className="text-[11px] text-violet-600 hover:text-violet-700 block">→ Contact</Link>
              ) : <p className="text-[10px] text-gray-300">No contact</p>}
              {ticket.mergedIntoId && (
                <Link href={`/tickets/${ticket.mergedIntoId}`} className="text-[11px] text-violet-600 hover:text-violet-700 block">→ Merged into</Link>
              )}
            </Section>

            <Section title="Timeline">
              {ticket.firstResponseAt && <Row label="1st response" value={formatRelativeTime(ticket.firstResponseAt)} />}
              {ticket.escalatedAt && <Row label="Escalated" value={formatRelativeTime(ticket.escalatedAt)} />}
              {ticket.resolvedAt && <Row label="Resolved" value={formatRelativeTime(ticket.resolvedAt)} />}
              {ticket.closedAt && <Row label="Closed" value={formatRelativeTime(ticket.closedAt)} />}
              <Row label="Created" value={formatRelativeTime(ticket.createdAt)} />
              <Row label="Updated" value={formatRelativeTime(ticket.updatedAt)} />
            </Section>

            {ticket.tags.length > 0 && (
              <Section title="Tags">
                <div className="flex flex-wrap gap-1">{ticket.tags.map((t) => (
                  <span key={t} className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{t}</span>
                ))}</div>
              </Section>
            )}
          </div>
        </aside>

        {/* Center panel */}
        <main className="flex-1 flex flex-col min-w-0 bg-white">
          <div className="h-9 border-b border-gray-200 px-3 flex items-center gap-4 shrink-0">
            {(['comments', 'activity', 'notes'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cn('text-[11px] py-1 border-b-2 transition-colors', tab === t ? 'border-violet-500 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600')}>
                {t === 'comments' ? `Comments (${ticket.comments.length})` : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {tab === 'comments' && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-auto p-3 space-y-3">
                {ticket.comments.length === 0 ? (
                  <p className="text-center text-gray-300 text-[11px] py-8">No comments yet.</p>
                ) : (
                  ticket.comments.map((c) => (
                    <div key={c.id} className={cn('rounded-lg p-3', c.isInternal ? 'bg-amber-50 border border-amber-100' : 'bg-gray-50 border border-gray-100')}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-medium text-gray-700 capitalize">{c.authorType}</span>
                        {c.isInternal && <span className="text-[9px] bg-amber-200 text-amber-800 px-1 rounded">INTERNAL</span>}
                        <span className="text-[9px] text-gray-400 ml-auto">{formatRelativeTime(c.createdAt)}</span>
                      </div>
                      <p className="text-[11px] text-gray-700 whitespace-pre-wrap">{c.content}</p>
                    </div>
                  ))
                )}
              </div>
              <div className="border-t border-gray-200 p-3 shrink-0 space-y-2">
                <textarea value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} placeholder="Write a comment…" rows={3} className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400" />
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-[11px] text-gray-600">
                    <input type="checkbox" checked={commentInternal} onChange={(e) => setCommentInternal(e.target.checked)} className="accent-amber-500" />
                    Internal note
                  </label>
                  <button onClick={() => addCommentM.mutate()} disabled={!commentDraft.trim() || addCommentM.isPending} className="flex items-center gap-1 bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30">
                    <Send size={10} /> {addCommentM.isPending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'activity' && (
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {!ticket.activities?.length ? (
                <p className="text-center text-gray-300 text-[11px] py-8">No activity yet.</p>
              ) : (
                ticket.activities.map((a) => (
                  <div key={a.id} className="flex items-start gap-2 py-1.5">
                    <div className="w-4 pt-0.5 shrink-0 flex justify-center">
                      {a.type === 'RESOLVED' ? <CheckCircle2 size={11} className="text-emerald-500" /> :
                       a.type === 'ESCALATED' ? <ArrowUpCircle size={11} className="text-red-500" /> :
                       a.type === 'ASSIGNED' ? <UserPlus size={11} className="text-blue-500" /> :
                       a.type === 'SLA_BREACHED' ? <AlertTriangle size={11} className="text-red-500" /> :
                       a.type === 'MERGED' ? <GitMerge size={11} className="text-violet-500" /> :
                       a.type === 'COMMENT_ADDED' ? <MessageSquare size={11} className="text-gray-400" /> :
                       <Clock size={11} className="text-gray-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[11px] font-medium text-gray-900">{a.title}</span>
                        <span className="text-[9px] text-gray-400 capitalize">{a.actorType}</span>
                        <span className="text-[9px] text-gray-400 ml-auto">{formatRelativeTime(a.createdAt)}</span>
                      </div>
                      {a.body && <p className="text-[10px] text-gray-500 mt-0.5">{a.body}</p>}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'notes' && (
            <div className="flex-1 overflow-auto p-3">
              <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Add a note to the ticket timeline..." rows={4} className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400 mb-2" />
              <button onClick={() => addNoteM.mutate()} disabled={!noteDraft.trim() || addNoteM.isPending} className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30">
                {addNoteM.isPending ? 'Saving…' : 'Add Note'}
              </button>
              <div className="mt-4 space-y-2">
                {ticket.activities?.filter((a) => a.type === 'NOTE_ADDED').map((a) => (
                  <div key={a.id} className="border border-gray-100 rounded p-2">
                    <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                      <span className="capitalize">{a.actorType}</span>
                      <span>{formatRelativeTime(a.createdAt)}</span>
                    </div>
                    <p className="text-[11px] text-gray-700 whitespace-pre-wrap">{a.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>

        {/* Right panel */}
        <aside className="w-56 border-l border-gray-200 bg-white overflow-auto shrink-0 p-3 space-y-2">
          <p className="text-[9px] uppercase tracking-widest text-gray-400 font-medium mb-1">Status</p>
          <div className="space-y-1">
            {(['IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'] as TicketStatus[]).map((s) => (
              ticket.status !== s && (
                <button key={s} onClick={() => changeStatusM.mutate({ status: s })} className={cn('w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[11px] font-medium', STATUS_COLORS[s], 'hover:opacity-80')}>
                  {s === 'RESOLVED' ? <Check size={11} /> : s === 'CLOSED' ? <XCircle size={11} /> : <Clock size={11} />}
                  {s.replace('_', ' ')}
                </button>
              )
            ))}
            {isTerminal && (
              <button onClick={() => changeStatusM.mutate({ status: 'OPEN' })} className="w-full flex items-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-700 px-2.5 py-1.5 rounded text-[11px] font-medium">
                <LifeBuoy size={11} /> Reopen
              </button>
            )}
          </div>

          <p className="text-[9px] uppercase tracking-widest text-gray-400 font-medium mb-1 pt-2">Actions</p>

          {!isTerminal && (
            <>
              <button onClick={() => {
                const userId = prompt('Assign to user id:');
                if (userId !== null) assignM.mutate(userId || null);
              }} className="w-full flex items-center gap-2 bg-gray-50 hover:bg-gray-100 text-gray-700 px-2.5 py-1.5 rounded text-[11px] font-medium">
                <UserPlus size={11} /> Assign
              </button>
              <button onClick={() => {
                const reason = prompt('Escalation reason?');
                if (reason !== null) escalateM.mutate(reason);
              }} className="w-full flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-700 px-2.5 py-1.5 rounded text-[11px] font-medium">
                <ArrowUpCircle size={11} /> Escalate
              </button>
              <button onClick={() => {
                const targetId = prompt('Merge into which ticket id?');
                if (targetId) mergeM.mutate(targetId);
              }} className="w-full flex items-center gap-2 bg-violet-50 hover:bg-violet-100 text-violet-700 px-2.5 py-1.5 rounded text-[11px] font-medium">
                <GitMerge size={11} /> Merge into…
              </button>
            </>
          )}

          {ticket.status === 'CLOSED' && (
            <button onClick={() => { if (confirm('Delete this ticket?')) deleteM.mutate(); }} className="w-full flex items-center gap-2 bg-gray-50 hover:bg-red-50 text-gray-700 hover:text-red-700 px-2.5 py-1.5 rounded text-[11px] font-medium">
              <Trash2 size={11} /> Delete
            </button>
          )}

          <div className="pt-2 mt-2 border-t border-gray-100">
            <Link href={`/chat?q=${encodeURIComponent(`Tell me about ticket ${ticket.ticketNumber}`)}`} className="w-full flex items-center gap-2 bg-violet-50 hover:bg-violet-100 text-violet-700 px-2.5 py-1.5 rounded text-[11px] font-medium">
              <MessageSquare size={11} /> Ask AI
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-widest text-gray-400 font-medium mb-1.5">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-gray-400 shrink-0">{label}</span>
      <span className="text-gray-700 text-right truncate">{value}</span>
    </div>
  );
}
