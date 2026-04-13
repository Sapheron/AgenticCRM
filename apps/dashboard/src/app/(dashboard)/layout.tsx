'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth.store';
import { useSocket } from '@/hooks/use-socket';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MessageSquare, Users, TrendingUp, Briefcase, CheckSquare,
  BarChart3, Settings, Megaphone, LogOut, Zap, CreditCard,
  FileText, Repeat, Package, Receipt, FileSpreadsheet,
  Target, Clipboard, Workflow, LifeBuoy, BookOpen, PieChart,
  Plug, FolderOpen, Brain, Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Permission required for each route
const ROUTE_PERMISSIONS: Record<string, string> = {
  '/chat': 'ai_chat',
  '/memory': 'memory',
  '/docs': 'ai_chat',
  '/contacts': 'contacts',
  '/leads': 'leads',
  '/deals': 'deals',
  '/tasks': 'tasks',
  '/products': 'products',
  '/broadcasts': 'broadcasts',
  '/templates': 'templates',
  '/sequences': 'sequences',
  '/campaigns': 'campaigns',
  '/forms': 'forms',
  '/quotes': 'quotes',
  '/invoices': 'invoices',
  '/payments': 'payments',
  '/tickets': 'tickets',
  '/kb': 'kb',
  '/workflows': 'workflows',
  '/analytics': 'analytics',
  '/reports': 'reports',
  '/documents': 'documents',
  '/integrations': 'integrations',
};

const ALL_NAV_SECTIONS = [
  {
    label: 'Insights',
    items: [
      { href: '/analytics', icon: BarChart3, label: 'Analytics', perm: 'analytics' },
      { href: '/reports', icon: PieChart, label: 'Reports', perm: 'reports' },
    ],
  },
  {
    label: '',
    items: [
      { href: '/chat', icon: MessageSquare, label: 'AI Chat', perm: 'ai_chat' },
      { href: '/memory', icon: Brain, label: 'Memory', perm: 'memory' },
      { href: '/docs', icon: Terminal, label: 'AI Commands', perm: 'ai_chat' },
    ],
  },
  {
    label: 'CRM',
    items: [
      { href: '/contacts', icon: Users, label: 'Contacts', perm: 'contacts' },
      { href: '/leads', icon: TrendingUp, label: 'Leads', perm: 'leads' },
      { href: '/deals', icon: Briefcase, label: 'Deals', perm: 'deals' },
      { href: '/tasks', icon: CheckSquare, label: 'Tasks', perm: 'tasks' },
      { href: '/products', icon: Package, label: 'Products', perm: 'products' },
    ],
  },
  {
    label: 'Engage',
    items: [
      { href: '/broadcasts', icon: Megaphone, label: 'Broadcasts', perm: 'broadcasts' },
      { href: '/templates', icon: FileText, label: 'Templates', perm: 'templates' },
      { href: '/sequences', icon: Repeat, label: 'Sequences', perm: 'sequences' },
      { href: '/campaigns', icon: Target, label: 'Campaigns', perm: 'campaigns' },
      { href: '/forms', icon: Clipboard, label: 'Forms', perm: 'forms' },
    ],
  },
  {
    label: 'Sales',
    items: [
      { href: '/quotes', icon: Receipt, label: 'Quotes', perm: 'quotes' },
      { href: '/invoices', icon: FileSpreadsheet, label: 'Invoices', perm: 'invoices' },
      { href: '/payments', icon: CreditCard, label: 'Payments', perm: 'payments' },
    ],
  },
  {
    label: 'Support',
    items: [
      { href: '/tickets', icon: LifeBuoy, label: 'Tickets', perm: 'tickets' },
      { href: '/kb', icon: BookOpen, label: 'Knowledge Base', perm: 'kb' },
    ],
  },
  {
    label: 'Automate',
    items: [
      { href: '/workflows', icon: Workflow, label: 'Workflows', perm: 'workflows' },
    ],
  },
  {
    label: 'More',
    items: [
      { href: '/documents', icon: FolderOpen, label: 'Documents', perm: 'documents' },
      { href: '/integrations', icon: Plug, label: 'Integrations', perm: 'integrations' },
    ],
  },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, logout, user } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  const [sidebarHover, setSidebarHover] = useState(false);

  // Filter nav sections by user permissions (admins see all)
  const navSections = useMemo(() => {
    if (!user) return [];
    const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
    const permissionSet = new Set(user.permissions ?? []);

    return ALL_NAV_SECTIONS
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => isAdmin || permissionSet.has(item.perm)),
      }))
      .filter((section) => section.items.length > 0);
  }, [user]);

  useEffect(() => setMounted(true), []);
  useSocket();

  useEffect(() => {
    if (mounted && !isAuthenticated()) {
      router.push('/login');
      return;
    }
    // Route gating: check if user has permission for current route
    if (mounted && isAuthenticated() && user) {
      const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
      if (!isAdmin && pathname.startsWith('/settings')) {
        // Settings is admin-only
        router.push('/chat');
        return;
      }
      // Check feature permissions
      const requiredPerm = Object.entries(ROUTE_PERMISSIONS).find(
        ([route]) => pathname === route || pathname.startsWith(route + '/'),
      )?.[1];
      if (requiredPerm && !(user.permissions ?? []).includes(requiredPerm) && pathname !== '/chat') {
        router.push('/chat');
      }
    }
  }, [mounted, isAuthenticated, user, pathname, router]);

  if (!mounted || !isAuthenticated()) return null;

  const expanded = sidebarHover;

  return (
    <div className="flex h-screen bg-[#fafafa]">
      {/* Sidebar */}
      <aside
        onMouseEnter={() => setSidebarHover(true)}
        onMouseLeave={() => setSidebarHover(false)}
        className={cn(
          'flex flex-col bg-[#0f0f10] transition-all duration-200 ease-out shrink-0 z-20',
          expanded ? 'w-52' : 'w-12',
        )}
      >
        {/* Logo */}
        <div className="h-12 flex items-center px-3 gap-2.5">
          <div className="w-6 h-6 rounded bg-violet-500 flex items-center justify-center shrink-0">
            <Zap size={12} className="text-white" />
          </div>
          {expanded && <span className="text-white text-xs font-semibold tracking-tight truncate">Open Agent CRM</span>}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-1.5 py-2 space-y-3 overflow-y-auto">
          {navSections.map((section) => (
            <div key={section.label || 'main'}>
              {section.label && expanded && (
                <p className="text-[10px] uppercase tracking-widest text-gray-500 px-2 mb-1 font-medium">{section.label}</p>
              )}
              {!section.label && !expanded && <div className="mb-1" />}
              <div className="space-y-0.5">
                {section.items.map(({ href, icon: Icon, label }) => {
                  const active = pathname === href || (href !== '/chat' && pathname.startsWith(href));
                  return (
                    <Link
                      key={href}
                      href={href}
                      title={label}
                      className={cn(
                        'flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs transition-colors',
                        active
                          ? 'bg-white/10 text-white'
                          : 'text-gray-400 hover:bg-white/5 hover:text-gray-200',
                      )}
                    >
                      <Icon size={15} className="shrink-0" />
                      {expanded && <span className="truncate">{label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Settings + User */}
        <div className="px-1.5 pb-2 space-y-0.5">
          <Link
            href="/settings"
            title="Settings"
            className={cn(
              'flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs transition-colors',
              pathname.startsWith('/settings')
                ? 'bg-white/10 text-white'
                : 'text-gray-400 hover:bg-white/5 hover:text-gray-200',
            )}
          >
            <Settings size={15} className="shrink-0" />
            {expanded && <span>Settings</span>}
          </Link>

          <div className="border-t border-white/5 pt-2 mt-2">
            <div className="flex items-center gap-2 px-2 py-1">
              <div className="w-5 h-5 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-[9px] font-bold shrink-0">
                {user?.firstName?.[0]}
              </div>
              {expanded && (
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-gray-300 truncate">{user?.firstName} {user?.lastName}</p>
                </div>
              )}
              {expanded && (
                <button
                  onClick={() => { logout(); router.push('/login'); }}
                  title="Sign out"
                  className="text-gray-500 hover:text-gray-300"
                >
                  <LogOut size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
