'use client';

/**
 * AI Commands docs page — renders every tool the AI chat agent can call.
 *
 * Backend source: GET /ai/chat/tools (returns the full catalog from
 * `getAdminToolCatalog()` in apps/api/src/modules/ai-chat/admin-tools.ts).
 *
 * Layout: left sidebar with categories + filter, main pane with each tool
 * shown as a card (name, description, parameter table, "core" badge for
 * tools always sent to the model).
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { Terminal, Search, Star, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface JsonSchemaProp {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  items?: { type?: string };
  default?: unknown;
}

interface ToolParameters {
  type?: string;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
}

interface CatalogEntry {
  name: string;
  description: string;
  category: string;
  core: boolean;
  parameters: ToolParameters;
}

export default function AiDocsPage() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [coreOnly, setCoreOnly] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const { data: tools, isLoading } = useQuery({
    queryKey: ['ai-tools-catalog'],
    queryFn: async () => {
      const r = await api.get<{ data: CatalogEntry[] }>('/ai/chat/tools');
      return r.data.data;
    },
  });

  const grouped = useMemo(() => {
    const map = new Map<string, CatalogEntry[]>();
    for (const t of tools ?? []) {
      const list = map.get(t.category) ?? [];
      list.push(t);
      map.set(t.category, list);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, items]) => ({
        category,
        items: items.sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [tools]);

  const filtered = useMemo(() => {
    return grouped
      .filter((g) => activeCategory === 'All' || g.category === activeCategory)
      .map((g) => ({
        ...g,
        items: g.items.filter((t) => {
          if (coreOnly && !t.core) return false;
          if (!search.trim()) return true;
          const q = search.trim().toLowerCase();
          return (
            t.name.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q)
          );
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [grouped, activeCategory, search, coreOnly]);

  const categories = ['All', ...grouped.map((g) => g.category)];
  const totalTools = tools?.length ?? 0;
  const coreCount = tools?.filter((t) => t.core).length ?? 0;

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      toast.success('Copied');
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    });
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 border-b border-gray-200 px-4 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-violet-500" />
          <span className="text-xs font-semibold text-gray-900">AI Commands</span>
          <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
            {totalTools} tools · {coreCount} core
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 border border-gray-200 rounded px-2">
            <Search size={11} className="text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tools…"
              className="text-[11px] py-1 w-44 focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={coreOnly}
              onChange={(e) => setCoreOnly(e.target.checked)}
              className="h-3 w-3"
            />
            Core only
          </label>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Sidebar — categories */}
        <aside className="w-48 border-r border-gray-200 bg-white overflow-auto shrink-0">
          <div className="p-2">
            {categories.map((cat) => {
              const count = cat === 'All'
                ? totalTools
                : grouped.find((g) => g.category === cat)?.items.length ?? 0;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={cn(
                    'w-full flex items-center justify-between text-left px-2.5 py-1.5 rounded text-[11px] mb-0.5 transition',
                    activeCategory === cat
                      ? 'bg-violet-50 text-violet-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-50',
                  )}
                >
                  <span>{cat}</span>
                  <span className="text-[9px] text-gray-400">{count}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-auto bg-gray-50/50">
          {isLoading ? (
            <div className="p-12 text-center text-xs text-gray-300">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-xs text-gray-400">No tools match.</div>
          ) : (
            <div className="p-4 space-y-6 max-w-4xl">
              {/* Intro */}
              {activeCategory === 'All' && !search && (
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <h2 className="text-sm font-semibold text-gray-900 mb-1">How AI commands work</h2>
                  <p className="text-[11px] text-gray-600 leading-relaxed">
                    Every tool below can be invoked by chatting with the AI assistant in <a href="/chat" className="text-violet-600 hover:underline">/chat</a>.
                    You don&rsquo;t need to know the tool names — just describe what you want in natural language and the AI will pick the right tool.
                    Tools marked <span className="inline-flex items-center gap-0.5 bg-violet-50 text-violet-700 px-1 rounded text-[9px]"><Star size={8} /> CORE</span> are always sent to the model;
                    the rest are still callable when the AI knows them by name (e.g. you say <em>&ldquo;use bulk_assign_leads&rdquo;</em>).
                  </p>
                </div>
              )}

              {filtered.map((group) => (
                <section key={group.category}>
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider">{group.category}</h3>
                    <span className="text-[10px] text-gray-400">{group.items.length}</span>
                  </div>
                  <div className="space-y-2">
                    {group.items.map((tool) => (
                      <ToolCard
                        key={tool.name}
                        tool={tool}
                        copied={copied === tool.name}
                        onCopy={() => copy(tool.name, tool.name)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function ToolCard({
  tool,
  copied,
  onCopy,
}: {
  tool: CatalogEntry;
  copied: boolean;
  onCopy: () => void;
}) {
  const props = tool.parameters?.properties ?? {};
  const required = new Set(tool.parameters?.required ?? []);
  const propEntries = Object.entries(props);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 hover:border-violet-200 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onCopy}
            className="font-mono text-[12px] font-semibold text-violet-700 hover:text-violet-800 flex items-center gap-1 group"
            title="Copy tool name"
          >
            {tool.name}
            {copied ? (
              <Check size={11} className="text-emerald-500" />
            ) : (
              <Copy size={11} className="text-gray-300 group-hover:text-gray-500" />
            )}
          </button>
          {tool.core && (
            <span className="inline-flex items-center gap-0.5 bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded text-[9px] font-medium">
              <Star size={8} /> CORE
            </span>
          )}
        </div>
      </div>
      <p className="text-[11px] text-gray-600 leading-relaxed">{tool.description}</p>

      {propEntries.length > 0 && (
        <div className="mt-2 border-t border-gray-100 pt-2">
          <p className="text-[9px] uppercase tracking-widest text-gray-400 mb-1">Parameters</p>
          <div className="space-y-1">
            {propEntries.map(([name, schema]) => {
              const type = formatType(schema);
              const isRequired = required.has(name);
              return (
                <div key={name} className="flex items-baseline gap-2 text-[10px]">
                  <code className={cn('font-mono shrink-0', isRequired ? 'text-gray-900 font-semibold' : 'text-gray-700')}>
                    {name}
                    {isRequired && <span className="text-red-500">*</span>}
                  </code>
                  <span className="text-violet-500 font-mono shrink-0">{type}</span>
                  {schema.description && (
                    <span className="text-gray-500 leading-relaxed">— {schema.description}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function formatType(schema: JsonSchemaProp): string {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.length <= 4
      ? schema.enum.map(String).join(' | ')
      : `enum(${schema.enum.length})`;
  }
  if (schema.type === 'array' && schema.items?.type) {
    return `${schema.items.type}[]`;
  }
  if (Array.isArray(schema.type)) return schema.type.join('|');
  return schema.type ?? 'any';
}
