import Link from 'next/link';
import { Bot, Smartphone, CreditCard, Users, Globe, Building, Webhook, ArrowUpCircle } from 'lucide-react';

const sections = [
  { href: '/settings/whatsapp', icon: Smartphone, title: 'WhatsApp', desc: 'Manage connected accounts' },
  { href: '/settings/ai', icon: Bot, title: 'AI Model', desc: 'Provider, model, system prompt' },
  { href: '/settings/payments', icon: CreditCard, title: 'Payments', desc: 'Gateway configuration' },
  { href: '/settings/team', icon: Users, title: 'Team', desc: 'Members and roles' },
  { href: '/settings/webhooks', icon: Globe, title: 'Webhooks', desc: 'Outbound endpoints' },
  { href: '/settings/integrations', icon: Webhook, title: 'Integrations', desc: 'Public URL & lead intake' },
  { href: '/settings/company', icon: Building, title: 'Company', desc: 'Profile and timezone' },
  { href: '/settings/system', icon: ArrowUpCircle, title: 'System', desc: 'Version, updates & changelog' },
];

export default function SettingsPage() {
  return (
    <div className="h-full flex flex-col">
      <div className="h-11 border-b border-gray-200 px-4 flex items-center shrink-0 bg-white">
        <span className="text-xs font-semibold text-gray-900">Settings</span>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {sections.map(({ href, icon: Icon, title, desc }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg p-3 hover:border-violet-300 transition group"
            >
              <div className="w-8 h-8 rounded bg-gray-50 flex items-center justify-center group-hover:bg-violet-50 transition shrink-0">
                <Icon size={14} className="text-gray-400 group-hover:text-violet-500 transition" />
              </div>
              <div>
                <p className="text-xs font-medium text-gray-900">{title}</p>
                <p className="text-[10px] text-gray-400">{desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
