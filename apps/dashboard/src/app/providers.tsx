'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useState } from 'react';

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
    </QueryClientProvider>
  );
}
