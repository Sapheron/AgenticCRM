'use client';

/**
 * Public KB article reader — unauthenticated.
 *
 * Fetches via `GET /public/kb/:slug` and renders the markdown content as
 * a clean help article with company branding. View count is bumped by the
 * API on each request.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertTriangle, BookOpen, Loader2 } from 'lucide-react';

interface PublicArticle {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  content: string;
  category: string | null;
  viewCount: number;
  updatedAt: string;
  company: { name: string };
}

const API_ORIGIN =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL
    ? process.env.NEXT_PUBLIC_API_URL
    : '';

function apiUrl(path: string): string {
  if (API_ORIGIN) return `${API_ORIGIN.replace(/\/$/, '')}${path}`;
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const proto = window.location.protocol;
    return `${proto}//${host}:3000${path}`;
  }
  return path;
}

export default function PublicKBArticlePage() {
  const params = useParams();
  const slug = params.slug as string;

  const [article, setArticle] = useState<PublicArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(apiUrl(`/public/kb/${slug}`));
        if (!res.ok) {
          if (!cancelled) setLoadError(res.status === 404 ? 'Article not found.' : `Error ${res.status}`);
          return;
        }
        const json = (await res.json()) as PublicArticle;
        if (!cancelled) setArticle(json);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  const layoutClasses = 'min-h-screen bg-gradient-to-br from-violet-50 via-white to-blue-50 py-10 px-4';

  if (loading) {
    return (
      <div className={layoutClasses + ' flex items-center justify-center'}>
        <div className="flex items-center gap-2 text-gray-400 text-sm"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      </div>
    );
  }

  if (loadError || !article) {
    return (
      <div className={layoutClasses + ' flex items-center justify-center'}>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 max-w-md text-center">
          <AlertTriangle size={28} className="mx-auto mb-3 text-amber-500" />
          <h1 className="text-sm font-semibold text-gray-900 mb-1">Article unavailable</h1>
          <p className="text-xs text-gray-500">{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={layoutClasses}>
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-[11px] text-gray-400 uppercase tracking-widest mb-2">
            <BookOpen size={12} />
            {article.company.name} · Knowledge Base
          </div>
          {article.category && (
            <span className="text-[10px] bg-violet-50 text-violet-700 px-2 py-0.5 rounded mb-2 inline-block">
              {article.category}
            </span>
          )}
        </div>

        {/* Article card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-8">
            <h1 className="text-xl font-semibold text-gray-900 mb-2">{article.title}</h1>
            {article.description && (
              <p className="text-sm text-gray-500 mb-6 leading-relaxed">{article.description}</p>
            )}

            {/* Content — render as preformatted markdown text for now.
                Phase 2: swap for a proper markdown renderer (react-markdown). */}
            <div className="prose prose-sm max-w-none text-gray-800 leading-relaxed">
              <pre className="whitespace-pre-wrap font-sans text-sm">{article.content}</pre>
            </div>
          </div>

          <div className="bg-gray-50 border-t border-gray-100 px-8 py-4 flex items-center justify-between text-[10px] text-gray-400">
            <span>
              Updated {new Date(article.updatedAt).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </span>
            <span>{article.viewCount} view{article.viewCount === 1 ? '' : 's'}</span>
          </div>
        </div>

        <p className="text-[10px] text-gray-400 text-center mt-6">
          Powered by <span className="font-semibold">Open Agent CRM</span>
        </p>
      </div>
    </div>
  );
}
