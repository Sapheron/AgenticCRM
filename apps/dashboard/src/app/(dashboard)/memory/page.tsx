'use client';

/**
 * Memory file browser — OpenClaw-style two-pane view.
 *
 * Left: list of MemoryFile rows (MEMORY.md, memory/YYYY-MM-DD-{slug}.md, etc.)
 * Right: markdown content of the selected file, with Edit / Save / Delete.
 *
 * The chunks/embeddings are managed automatically server-side: editing a file
 * triggers a re-chunk + re-embed in MemoryService.writeFile.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { Brain, Plus, Trash2, FileText, Search, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface MemoryFile {
  id: string;
  path: string;
  source: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

interface MemoryStats {
  files: number;
  chunks: number;
  recalls: number;
  embeddedChunks: number;
  embeddingDim: number;
}

interface SearchHit {
  id: string;
  path: string;
  source: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
  vecScore: number;
  textScore: number;
}

export default function MemoryPage() {
  const qc = useQueryClient();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [newContent, setNewContent] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);

  const { data: files } = useQuery({
    queryKey: ['memory-files'],
    queryFn: async () => {
      const r = await api.get<MemoryFile[]>('/memory/files');
      return r.data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['memory-stats'],
    queryFn: async () => {
      const r = await api.get<MemoryStats>('/memory/stats');
      return r.data;
    },
  });

  // Auto-select MEMORY.md or first file
  useEffect(() => {
    if (selectedPath || !files?.length) return;
    const memoryDoc = files.find((f) => f.path === 'MEMORY.md');
    setSelectedPath(memoryDoc?.path ?? files[0].path);
  }, [files, selectedPath]);

  const { data: fileContent } = useQuery({
    queryKey: ['memory-file', selectedPath],
    enabled: !!selectedPath,
    queryFn: async () => {
      const r = await api.get<{ path: string; content: string | null }>('/memory/file', {
        params: { path: selectedPath },
      });
      return r.data.content ?? '';
    },
  });

  useEffect(() => {
    if (!editing) setDraft(fileContent ?? '');
  }, [fileContent, editing]);

  const writeMutation = useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      api.post('/memory/file', { path, content }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['memory-files'] });
      void qc.invalidateQueries({ queryKey: ['memory-file', selectedPath] });
      void qc.invalidateQueries({ queryKey: ['memory-stats'] });
      setEditing(false);
      toast.success('Memory saved & re-indexed');
    },
    onError: () => toast.error('Failed to save'),
  });

  const createMutation = useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      api.post('/memory/file', { path, content }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['memory-files'] });
      void qc.invalidateQueries({ queryKey: ['memory-stats'] });
      setSelectedPath(variables.path);
      setShowCreate(false);
      setNewPath('');
      setNewContent('');
      toast.success('Memory file created');
    },
    onError: () => toast.error('Failed to create'),
  });

  const deleteMutation = useMutation({
    mutationFn: (path: string) => api.delete('/memory/file', { params: { path } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['memory-files'] });
      void qc.invalidateQueries({ queryKey: ['memory-stats'] });
      setSelectedPath(null);
      toast.success('Deleted');
    },
  });

  const searchMutation = useMutation({
    mutationFn: (query: string) =>
      api.post<SearchHit[]>('/memory/search', { query, maxResults: 15 }),
    onSuccess: (r) => setSearchHits(r.data),
    onError: () => toast.error('Search failed'),
  });

  const groupedFiles = useMemo(() => {
    const groups: Record<string, MemoryFile[]> = { memory: [], session: [], wiki: [], other: [] };
    for (const f of files ?? []) {
      const key = (groups[f.source] ? f.source : 'other') as keyof typeof groups;
      groups[key].push(f);
    }
    return groups;
  }, [files]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-violet-500" />
          <span className="text-xs font-semibold text-gray-900">AI Memory</span>
          {stats && (
            <span className="text-[9px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
              {stats.files} files · {stats.chunks} chunks · {stats.embeddedChunks} embedded · {stats.recalls} recalls
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 border border-gray-200 rounded px-1.5">
            <Search size={11} className="text-gray-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchQuery.trim()) searchMutation.mutate(searchQuery.trim());
                if (e.key === 'Escape') {
                  setSearchQuery('');
                  setSearchHits(null);
                }
              }}
              placeholder="Search memory…"
              className="text-[11px] py-1 w-44 focus:outline-none"
            />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded text-[11px] font-medium"
          >
            <Plus size={11} /> New File
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* File list */}
        <aside className="w-64 border-r border-gray-200 bg-white overflow-auto shrink-0">
          {(['memory', 'session', 'wiki', 'other'] as const).map((src) => {
            const list = groupedFiles[src];
            if (!list?.length) return null;
            return (
              <div key={src}>
                <p className="text-[9px] uppercase tracking-widest text-gray-400 px-3 pt-2 pb-1 font-medium">
                  {src}
                </p>
                {list.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      setSelectedPath(f.path);
                      setEditing(false);
                    }}
                    className={cn(
                      'w-full text-left px-3 py-1.5 flex items-center gap-2 text-[11px] hover:bg-gray-50',
                      selectedPath === f.path && 'bg-violet-50 text-violet-700',
                    )}
                  >
                    <FileText size={11} className="shrink-0" />
                    <span className="truncate flex-1">{f.path}</span>
                    <span className="text-[9px] text-gray-400">{f.size}b</span>
                  </button>
                ))}
              </div>
            );
          })}
          {!files?.length && (
            <div className="p-6 text-center text-[11px] text-gray-400">
              No memory files yet.
              <br />
              Click <span className="font-medium">New File</span> to start.
            </div>
          )}
        </aside>

        {/* Main pane */}
        <main className="flex-1 overflow-auto bg-white">
          {searchHits ? (
            <SearchResults
              hits={searchHits}
              onClose={() => {
                setSearchHits(null);
                setSearchQuery('');
              }}
              onOpen={(path) => {
                setSelectedPath(path);
                setSearchHits(null);
                setSearchQuery('');
              }}
            />
          ) : selectedPath ? (
            <FileView
              path={selectedPath}
              content={fileContent ?? ''}
              draft={draft}
              setDraft={setDraft}
              editing={editing}
              setEditing={setEditing}
              onSave={() => writeMutation.mutate({ path: selectedPath, content: draft })}
              onDelete={() => {
                if (confirm(`Delete ${selectedPath}?`)) deleteMutation.mutate(selectedPath);
              }}
              saving={writeMutation.isPending}
            />
          ) : (
            <div className="p-12 text-center text-[11px] text-gray-400">
              Select a memory file from the sidebar.
            </div>
          )}
        </main>
      </div>

      {/* Create dialog */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow-xl w-[480px] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold">New Memory File</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            </div>
            <input
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="path (e.g. memory/notes.md or MEMORY.md)"
              className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              rows={10}
              placeholder="# Markdown content&#10;&#10;Anything you write here will be chunked, embedded, and searchable by the AI."
              className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400 font-mono leading-relaxed"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="text-gray-500 text-[11px] px-2 py-1">
                Cancel
              </button>
              <button
                onClick={() => createMutation.mutate({ path: newPath, content: newContent })}
                disabled={!newPath || !newContent}
                className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] disabled:opacity-30"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FileView({
  path,
  content,
  draft,
  setDraft,
  editing,
  setEditing,
  onSave,
  onDelete,
  saving,
}: {
  path: string;
  content: string;
  draft: string;
  setDraft: (v: string) => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="h-9 border-b border-gray-100 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <FileText size={11} className="text-gray-400" />
          <span className="text-[11px] text-gray-700 font-medium">{path}</span>
        </div>
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <button
                onClick={() => setEditing(false)}
                className="text-gray-500 hover:text-gray-700 text-[11px] px-2 py-0.5"
              >
                Cancel
              </button>
              <button
                onClick={onSave}
                disabled={saving}
                className="flex items-center gap-1 bg-violet-600 hover:bg-violet-700 text-white px-2.5 py-0.5 rounded text-[11px] disabled:opacity-50"
              >
                <Save size={11} /> {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                className="text-violet-600 hover:text-violet-700 text-[11px] px-2 py-0.5"
              >
                Edit
              </button>
              <button
                onClick={onDelete}
                className="text-gray-400 hover:text-red-500 p-1 rounded"
                title="Delete"
              >
                <Trash2 size={11} />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full h-full font-mono text-[11px] leading-relaxed focus:outline-none resize-none"
          />
        ) : (
          <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-gray-800">
            {content || '(empty)'}
          </pre>
        )}
      </div>
    </div>
  );
}

function SearchResults({
  hits,
  onClose,
  onOpen,
}: {
  hits: SearchHit[];
  onClose: () => void;
  onOpen: (path: string) => void;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="h-9 border-b border-gray-100 px-4 flex items-center justify-between shrink-0">
        <span className="text-[11px] font-medium text-gray-700">{hits.length} hit{hits.length === 1 ? '' : 's'}</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-[11px]">
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-auto divide-y divide-gray-100">
        {hits.map((h) => (
          <button
            key={h.id}
            onClick={() => onOpen(h.path)}
            className="w-full text-left px-4 py-3 hover:bg-gray-50"
          >
            <div className="flex items-center gap-2 mb-1">
              <FileText size={11} className="text-gray-400" />
              <span className="text-[11px] font-medium text-violet-600">{h.path}</span>
              <span className="text-[9px] text-gray-400">L{h.startLine}-{h.endLine}</span>
              <span className="text-[9px] text-gray-400 ml-auto">
                score {h.score.toFixed(3)} · vec {h.vecScore.toFixed(2)} · text {h.textScore.toFixed(2)}
              </span>
            </div>
            <p className="text-[11px] text-gray-600 line-clamp-3">{h.text}</p>
          </button>
        ))}
        {hits.length === 0 && (
          <div className="p-8 text-center text-[11px] text-gray-400">No results.</div>
        )}
      </div>
    </div>
  );
}
