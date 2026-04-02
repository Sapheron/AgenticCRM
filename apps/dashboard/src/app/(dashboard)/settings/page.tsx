import Link from 'next/link';
import { Bot, Smartphone, CreditCard, Users, Globe, Building } from 'lucide-react';

const settingsSections = [
  { href: '/settings/whatsapp', icon: Smartphone, title: 'WhatsApp', description: 'Connect and manage WhatsApp accounts' },
  { href: '/settings/ai', icon: Bot, title: 'AI Model', description: 'Configure AI provider, model, and system prompt' },
  { href: '/settings/payments', icon: CreditCard, title: 'Payment Gateway', description: 'Set up Razorpay, Stripe, or other gateways' },
  { href: '/settings/team', icon: Users, title: 'Team', description: 'Manage team members and roles' },
  { href: '/settings/webhooks', icon: Globe, title: 'Webhooks', description: 'Configure outbound webhook endpoints' },
  { href: '/settings/company', icon: Building, title: 'Company', description: 'Update company profile and timezone' },
];

export default function SettingsPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Settings</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {settingsSections.map(({ href, icon: Icon, title, description }) => (
          <Link
            key={href}
            href={href}
            className="bg-white border border-gray-200 rounded-xl p-5 hover:border-green-300 hover:shadow-sm transition group"
          >
            <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center mb-3 group-hover:bg-green-100 transition">
              <Icon size={20} className="text-green-600" />
            </div>
            <h3 className="font-semibold text-gray-900 mb-1">{title}</h3>
            <p className="text-sm text-gray-500">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
