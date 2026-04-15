'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useState, useEffect, useCallback } from 'react';
import { setUpdateVisible } from '@/lib/api-client';

/**
 * Global TanStack Query setup.
 *
 * Two important behaviors here, both of which prevent the "I edited X and
 * the list didn't update without a hard reload" UX bug:
 *
 *   1. Aggressive freshness — `staleTime: 0`, plus refetch on mount, on
 *      window focus, and on network reconnect. Any time the user navigates
 *      back to a list page (even via browser back), it pulls fresh data.
 *
 *   2. Global mutation → invalidate hook — every successful mutation runs
 *      `invalidateQueries()` once, which marks every query in the cache
 *      stale and immediately refetches the ones currently mounted. This is
 *      heavy-handed on purpose: it means you can edit a lead from
 *      `/leads/[id]`, navigate back to `/leads`, and see the change without
 *      having to remember to add a per-page invalidation to every mutation.
 *
 *   We still encourage per-page `invalidateQueries({queryKey: [...]})` for
 *   precision (see leads/[id], deals/[id], contacts/[id]). The global hook
 *   just guarantees nothing slips through.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          // Always treat data as stale so the next observer triggers a refetch.
          staleTime: 0,
          retry: 1,
          refetchOnMount: 'always',
          refetchOnWindowFocus: true,
          refetchOnReconnect: true,
        },
      },
    });

    // Global mutation success → invalidate every query in the cache.
    // We attach this AFTER construction so we can reference `client` itself.
    client.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success') {
        void client.invalidateQueries();
      }
    });

    return client;
  });

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster richColors position="top-right" />
      <UpdateOverlay />
    </QueryClientProvider>
  );
}

/** Full-screen overlay shown when API returns 502/503 (system updating). */
function UpdateOverlay() {
  const [visible, setVisible] = useState(false);
  const [dots, setDots] = useState('');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const handler = (e: Event) => setVisible((e as CustomEvent).detail as boolean);
    window.addEventListener('system-update', handler);
    return () => window.removeEventListener('system-update', handler);
  }, []);

  // Animate dots
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setDots((d) => (d.length >= 3 ? '' : d + '.')), 500);
    return () => clearInterval(id);
  }, [visible]);

  // Track elapsed seconds
  useEffect(() => {
    if (!visible) { setElapsed(0); return; }
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [visible]);

  // Auto-retry health check every 5s
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (res.ok) {
        setUpdateVisible(false);
        window.location.reload();
      }
    } catch { /* still down */ }
  }, []);

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(checkHealth, 5000);
    return () => clearInterval(id);
  }, [visible, checkHealth]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/95 backdrop-blur-sm">
      <div className="text-center space-y-4 max-w-sm px-6">
        <div className="mx-auto w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
          <svg className="w-6 h-6 text-gray-600 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">System is updating{dots}</h2>
          <p className="text-xs text-gray-500 mt-1">
            AgenticCRM is installing a new version. This usually takes 30–90 seconds.
          </p>
        </div>
        <div className="text-[10px] text-gray-400">
          {elapsed > 0 && <span>Waiting {elapsed}s</span>}
          {elapsed > 10 && <span> · Auto-checking every 5s</span>}
        </div>
        <div className="w-48 mx-auto h-1 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-gray-400 rounded-full animate-pulse" style={{ width: `${Math.min(95, elapsed * 1.5)}%`, transition: 'width 1s linear' }} />
        </div>
      </div>
    </div>
  );
}
