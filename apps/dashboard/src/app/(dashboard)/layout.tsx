'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth.store';
import { useSocket } from '@/hooks/use-socket';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MessageSquare, Users, TrendingUp, Briefcase, CheckSquare,
  BarChart3, Settings, Megaphone, LogOut, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/chat', icon: MessageSquare, label: 'AI Chat' },
  { href: '/contacts', icon: Users, label: 'Contacts' },
  { href: '/leads', icon: TrendingUp, label: 'Leads' },
  { href: '/deals', icon: Briefcase, label: 'Deals' },
  { href: '/tasks', icon: CheckSquare, label: 'Tasks' },
  { href: '/broadcasts', icon: Megaphone, label: 'Broadcast' },
  { href: '/analytics', icon: BarChart3, label: 'Analytics' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, logout, user } = useAuthStore();
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch — auth state comes from localStorage
  useEffect(() => setMounted(true), []);

  // Initialize WebSocket
  useSocket();

  useEffect(() => {
    if (mounted && !isAuthenticated()) {
      router.push('/login');
    }
  }, [mounted, isAuthenticated, router]);

  if (!mounted || !isAuthenticated()) return null;

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className="w-16 lg:w-56 bg-gray-900 flex flex-col">
        {/* Logo */}
        <div className="p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center shrink-0">
            <Zap size={16} className="text-white" />
          </div>
          <span className="hidden lg:block text-white font-bold text-sm truncate">WA AI CRM</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-4 space-y-1">
          {navItems.map(({ href, icon: Icon, label }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                  active
                    ? 'bg-green-600 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white',
                )}
              >
                <Icon size={18} className="shrink-0" />
                <span className="hidden lg:block">{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User + Logout */}
        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-white text-xs shrink-0">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            <div className="hidden lg:block min-w-0">
              <p className="text-white text-xs font-medium truncate">{user?.firstName} {user?.lastName}</p>
              <p className="text-gray-400 text-xs truncate">{user?.role}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-gray-400 hover:text-white text-xs w-full"
          >
            <LogOut size={14} />
            <span className="hidden lg:block">Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
