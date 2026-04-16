'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  ArrowLeft, Phone, Mail, Building, Briefcase, MapPin,
  TrendingUp, CreditCard, CheckSquare, Save, X,
  Plus, Trash2, UserX, StickyNote, Pencil, Check,
} from 'lucide-react';

interface Contact {
  id: string;
  phoneNumber: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  companyName?: string;
  jobTitle?: string;
  address?: string;
  tags: string[];
  lifecycleStage: string;
  score: number;
  notes?: string;
  isBlocked: boolean;
  optedOut: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TimelineItem {
  type: 'message' | 'lead' | 'deal' | 'task' | 'payment' | 'note';
  date: string;
  data: Record<string, unknown>;
}

interface ContactNote {
  id: string;
  content: string;
  createdAt: string;
}

const LIFECYCLE_COLORS: Record<string, string> = {
  SUBSCRIBER: 'bg-gray-100 text-gray-600',
  LEAD: 'bg-gray-50 text-gray-700',
  MQL: 'bg-gray-50 text-gray-900',
  SQL: 'bg-gray-50 text-gray-900',
  OPPORTUNITY: 'bg-amber-50 text-amber-600',
  CUSTOMER: 'bg-emerald-50 text-emerald-600',
  EVANGELIST: 'bg-pink-50 text-pink-600',
};

const LIFECYCLE_STAGES = ['SUBSCRIBER', 'LEAD', 'MQL', 'SQL', 'OPPORTUNITY', 'CUSTOMER', 'EVANGELIST'];

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [noteText, setNoteText] = useState('');
  const [newTag, setNewTag] = useState('');
  const [editMode, setEditMode] = useState(false);
  // Inline note editing — only one note at a time.
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');

  // Edit form state
  const [form, setForm] = useState<Record<string, string>>({});

  const { data: contact, isLoading } = useQuery({
    queryKey: ['contact', id],
    queryFn: async () => {
      const res = await api.get<{ data: Contact }>(`/contacts/${id}`);
      return res.data.data;
    },
  });

  const { data: timeline } = useQuery({
    queryKey: ['contact-timeline', id],
    queryFn: async () => {
      const res = await api.get<{ data: TimelineItem[] }>(`/contacts/${id}/timeline`);
      return res.data.data;
    },
    enabled: !!id,
  });

  const { data: notes } = useQuery({
    queryKey: ['contact-notes', id],
    queryFn: async () => {
      const res = await api.get<{ data: ContactNote[] }>(`/contacts/${id}/notes`);
      return res.data.data;
    },
    enabled: !!id,
  });

  const { data: tags } = useQuery({
    queryKey: ['tags'],
    queryFn: async () => {
      const res = await api.get<{ data: Array<{ id: string; name: string; color: string }> }>('/tags');
      return res.data.data;
    },
  });

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ['contact', id] });
    void qc.invalidateQueries({ queryKey: ['contacts'] }); // Also refresh the list page
  };

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/contacts/${id}`, data),
    onSuccess: () => { invalidateAll(); toast.success('Saved'); },
    onError: () => toast.error('Failed to save'),
  });

  const addNoteMutation = useMutation({
    mutationFn: () => api.post(`/contacts/${id}/notes`, { content: noteText }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contact-notes', id] });
      void qc.invalidateQueries({ queryKey: ['contact-timeline', id] });
      setNoteText('');
      toast.success('Note added');
    },
    onError: () => toast.error('Failed'),
  });

  const updateNoteMutation = useMutation({
    mutationFn: ({ noteId, content }: { noteId: string; content: string }) =>
      api.patch(`/contacts/${id}/notes/${noteId}`, { content }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contact-notes', id] });
      void qc.invalidateQueries({ queryKey: ['contact-timeline', id] });
      setEditingNoteId(null);
      setEditingNoteText('');
      toast.success('Note updated');
    },
    onError: () => toast.error('Failed to update'),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (noteId: string) => api.delete(`/contacts/${id}/notes/${noteId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contact-notes', id] });
      void qc.invalidateQueries({ queryKey: ['contact-timeline', id] });
      toast.success('Note deleted');
    },
    onError: () => toast.error('Failed to delete'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/contacts/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contacts'] });
      toast.success('Deleted');
      router.push('/contacts');
    },
  });

  if (isLoading || !contact) {
    return <div className="p-4 text-xs text-gray-300">Loading...</div>;
  }

  const displayName = contact.displayName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown';
  const initials = (displayName[0] || '?').toUpperCase();

  const startEdit = () => {
    setForm({
      displayName: contact.displayName || '',
      firstName: contact.firstName || '',
      lastName: contact.lastName || '',
      phoneNumber: contact.phoneNumber || '',
      email: contact.email || '',
      companyName: contact.companyName || '',
      jobTitle: contact.jobTitle || '',
      address: contact.address || '',
    });
    setEditMode(true);
  };

  const saveEdit = () => {
    // Only send changed fields
    const changes: Record<string, string> = {};
    if (form.displayName !== (contact.displayName || '')) changes.displayName = form.displayName;
    if (form.firstName !== (contact.firstName || '')) changes.firstName = form.firstName;
    if (form.lastName !== (contact.lastName || '')) changes.lastName = form.lastName;
    if (form.phoneNumber !== contact.phoneNumber) changes.phoneNumber = form.phoneNumber;
    if (form.email !== (contact.email || '')) changes.email = form.email;
    if (form.companyName !== (contact.companyName || '')) changes.companyName = form.companyName;
    if (form.jobTitle !== (contact.jobTitle || '')) changes.jobTitle = form.jobTitle;
    if (form.address !== (contact.address || '')) changes.address = form.address;

    if (Object.keys(changes).length > 0) {
      updateMutation.mutate(changes);
    }
    setEditMode(false);
  };

  const handleAddTag = () => {
    const trimmed = newTag.trim();
    if (!trimmed) return;
    if ((contact.tags || []).includes(trimmed)) { setNewTag(''); return; }
    updateMutation.mutate(
      { tags: [...(contact.tags || []), trimmed] },
      {
        onSuccess: () => {
          setNewTag('');
          // Also refresh the tags autocomplete list — the user may have typed
          // a brand-new tag name the backend is about to surface.
          void qc.invalidateQueries({ queryKey: ['tags'] });
        },
      },
    );
  };

  const handleRemoveTag = (tag: string) => {
    updateMutation.mutate({ tags: (contact.tags || []).filter((t) => t !== tag) });
  };

  // Filter out WhatsApp messages from timeline
  const filteredTimeline = (timeline || []).filter((item) => item.type !== 'message');

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center gap-3 shrink-0 bg-white">
        <button onClick={() => router.push('/contacts')} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={14} />
        </button>
        <div className="w-7 h-7 rounded-full bg-gray-100 text-gray-900 flex items-center justify-center text-xs font-bold">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-900 truncate">{displayName}</p>
          <p className="text-[10px] text-gray-400">{contact.phoneNumber}</p>
        </div>
        <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium', LIFECYCLE_COLORS[contact.lifecycleStage] || 'bg-gray-100 text-gray-500')}>
          {contact.lifecycleStage}
        </span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">
          Score: {contact.score}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 h-full">
          {/* Left: Contact Info */}
          <div className="border-r border-gray-200 bg-white p-4 space-y-4 overflow-auto">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Contact Info</p>
              {!editMode ? (
                <button onClick={startEdit} className="text-[10px] text-gray-800 hover:text-gray-900 font-medium">
                  Edit
                </button>
              ) : (
                <div className="flex gap-1">
                  <button onClick={saveEdit} disabled={updateMutation.isPending} className="flex items-center gap-0.5 text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded hover:bg-gray-800 disabled:opacity-50">
                    <Save size={9} /> Save
                  </button>
                  <button onClick={() => setEditMode(false)} className="flex items-center gap-0.5 text-[10px] text-gray-400 px-1.5 py-0.5 rounded hover:bg-gray-100">
                    <X size={9} /> Cancel
                  </button>
                </div>
              )}
            </div>

            {editMode ? (
              <div className="space-y-2">
                {[
                  { key: 'displayName', label: 'Display Name', icon: Phone },
                  { key: 'firstName', label: 'First Name', icon: Phone },
                  { key: 'lastName', label: 'Last Name', icon: Phone },
                  { key: 'phoneNumber', label: 'Phone', icon: Phone },
                  { key: 'email', label: 'Email', icon: Mail, type: 'email' },
                  { key: 'companyName', label: 'Company', icon: Building },
                  { key: 'jobTitle', label: 'Job Title', icon: Briefcase },
                  { key: 'address', label: 'Address', icon: MapPin },
                ].map(({ key, label, icon: Icon, type }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Icon size={11} className="text-gray-300 shrink-0" />
                    <div className="flex-1">
                      <label className="text-[9px] text-gray-400 block">{label}</label>
                      <input
                        value={form[key] || ''}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                        type={type || 'text'}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-1.5">
                {[
                  { label: 'Display Name', value: contact.displayName, icon: Phone },
                  { label: 'First Name', value: contact.firstName, icon: Phone },
                  { label: 'Last Name', value: contact.lastName, icon: Phone },
                  { label: 'Phone', value: contact.phoneNumber, icon: Phone },
                  { label: 'Email', value: contact.email, icon: Mail },
                  { label: 'Company', value: contact.companyName, icon: Building },
                  { label: 'Job Title', value: contact.jobTitle, icon: Briefcase },
                  { label: 'Address', value: contact.address, icon: MapPin },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="flex items-start gap-2 py-1">
                    <Icon size={11} className="text-gray-300 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[9px] text-gray-400">{label}</p>
                      <p className="text-xs text-gray-900">{value || <span className="text-gray-300 italic">—</span>}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Lifecycle */}
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Lifecycle Stage</p>
              <select
                value={contact.lifecycleStage}
                onChange={(e) => updateMutation.mutate({ lifecycleStage: e.target.value })}
                className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400"
              >
                {LIFECYCLE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Tags */}
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Tags</p>
              <div className="flex flex-wrap gap-1 mb-2">
                {(contact.tags || []).map((tag) => (
                  <span key={tag} className="text-[10px] bg-gray-50 text-gray-900 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                    {tag}
                    <button onClick={() => handleRemoveTag(tag)} className="text-gray-400 hover:text-gray-900 ml-0.5">×</button>
                  </span>
                ))}
                {(contact.tags || []).length === 0 && <span className="text-[10px] text-gray-300 italic">No tags</span>}
              </div>
              <div className="flex gap-1">
                <input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newTag.trim()) {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  list="contact-tag-suggestions"
                  placeholder="Add tag…"
                  className="flex-1 border border-gray-200 rounded px-2 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
                <datalist id="contact-tag-suggestions">
                  {(tags || [])
                    .filter((t) => !(contact.tags || []).includes(t.name))
                    .map((t) => (
                      <option key={t.id} value={t.name} />
                    ))}
                </datalist>
                <button
                  onClick={handleAddTag}
                  disabled={!newTag.trim() || updateMutation.isPending}
                  className="bg-gray-900 text-white px-2 py-1 rounded text-[10px] disabled:opacity-30"
                >
                  <Plus size={10} />
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-2 border-t border-gray-100 space-y-1">
              <button onClick={() => { if (confirm('Delete this contact?')) deleteMutation.mutate(); }} className="flex items-center gap-1.5 text-[10px] text-red-500 hover:text-red-600 w-full py-1">
                <Trash2 size={10} /> Delete contact
              </button>
              {!contact.optedOut && (
                <button onClick={() => updateMutation.mutate({ optedOut: true })} className="flex items-center gap-1.5 text-[10px] text-gray-400 hover:text-gray-600 w-full py-1">
                  <UserX size={10} /> Opt out (GDPR)
                </button>
              )}
            </div>
          </div>

          {/* Middle: Timeline (no WhatsApp messages) */}
          <div className="bg-gray-50 p-4 overflow-auto">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Activity Timeline</p>
            {!filteredTimeline.length ? (
              <p className="text-xs text-gray-300 italic">No activity yet</p>
            ) : (
              <div className="space-y-2">
                {filteredTimeline.map((item, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className={cn('w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5', {
                      'bg-green-50': item.type === 'lead',
                      'bg-gray-50': item.type === 'deal',
                      'bg-amber-50': item.type === 'task',
                      'bg-emerald-50': item.type === 'payment',
                      'bg-gray-100': item.type === 'note',
                    })}>
                      {item.type === 'lead' && <TrendingUp size={10} className="text-green-500" />}
                      {item.type === 'deal' && <Briefcase size={10} className="text-gray-800" />}
                      {item.type === 'task' && <CheckSquare size={10} className="text-amber-500" />}
                      {item.type === 'payment' && <CreditCard size={10} className="text-emerald-500" />}
                      {item.type === 'note' && <StickyNote size={10} className="text-gray-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-gray-700">
                        {item.type === 'lead' && `Lead: ${(item.data as Record<string, string>).title} [${(item.data as Record<string, string>).status}]`}
                        {item.type === 'deal' && `Deal: ${(item.data as Record<string, string>).title} [${(item.data as Record<string, string>).stage}]`}
                        {item.type === 'task' && `Task: ${(item.data as Record<string, string>).title} [${(item.data as Record<string, string>).status}]`}
                        {item.type === 'payment' && `Payment: ₹${Number((item.data as Record<string, number>).amount) / 100} [${(item.data as Record<string, string>).status}]`}
                        {item.type === 'note' && ((item.data as Record<string, string>).content || '').slice(0, 100)}
                      </p>
                      <p className="text-[9px] text-gray-300">{new Date(item.date).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Notes */}
          <div className="bg-white p-4 overflow-auto border-l border-gray-200">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Notes</p>
            <div className="mb-3">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Write a note..."
                rows={3}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400 resize-none placeholder:text-gray-300"
              />
              <button
                onClick={() => addNoteMutation.mutate()}
                disabled={!noteText.trim() || addNoteMutation.isPending}
                className="mt-1.5 bg-gray-900 text-white px-3 py-1 rounded text-[10px] disabled:opacity-30 flex items-center gap-1"
              >
                <Plus size={9} /> Add Note
              </button>
            </div>
            <div className="space-y-2">
              {(notes || []).length === 0 && <p className="text-xs text-gray-300 italic">No notes yet</p>}
              {(notes || []).map((note) => {
                const isEditing = editingNoteId === note.id;
                return (
                  <div key={note.id} className="group border border-gray-100 rounded p-2.5 bg-gray-50/50">
                    {isEditing ? (
                      <>
                        <textarea
                          value={editingNoteText}
                          onChange={(e) => setEditingNoteText(e.target.value)}
                          rows={3}
                          className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400 resize-none bg-white"
                          autoFocus
                        />
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <button
                            onClick={() => {
                              const next = editingNoteText.trim();
                              if (!next || next === note.content) {
                                setEditingNoteId(null);
                                setEditingNoteText('');
                                return;
                              }
                              updateNoteMutation.mutate({ noteId: note.id, content: next });
                            }}
                            disabled={updateNoteMutation.isPending || !editingNoteText.trim()}
                            className="flex items-center gap-0.5 bg-gray-900 text-white px-2 py-0.5 rounded text-[10px] hover:bg-gray-800 disabled:opacity-30"
                          >
                            <Check size={9} /> Save
                          </button>
                          <button
                            onClick={() => { setEditingNoteId(null); setEditingNoteText(''); }}
                            className="flex items-center gap-0.5 text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded text-[10px]"
                          >
                            <X size={9} /> Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-start gap-2">
                          <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed flex-1 min-w-0">
                            {note.content}
                          </p>
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <button
                              onClick={() => { setEditingNoteId(note.id); setEditingNoteText(note.content); }}
                              className="text-gray-400 hover:text-gray-700 p-1 rounded hover:bg-gray-100"
                              title="Edit note"
                            >
                              <Pencil size={11} />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm('Delete this note?')) deleteNoteMutation.mutate(note.id);
                              }}
                              className="text-gray-400 hover:text-red-500 p-1 rounded hover:bg-gray-100"
                              title="Delete note"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>
                        <p className="text-[9px] text-gray-300 mt-1.5">{new Date(note.createdAt).toLocaleString()}</p>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
