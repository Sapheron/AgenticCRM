'use client';

import { useEffect, useState } from 'react';
import { Webhook, Copy, CheckCircle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

const WEBHOOK_DOCS: Record<string, { label: string; path: string; events: string[]; setupUrl?: string }> = {
  razorpay: {
    label: 'Razorpay',
    path: '/api/webhooks/payment/razorpay',
    events: ['payment_link.paid', 'payment_link.expired'],
    setupUrl: 'https://dashboard.razorpay.com/app/webhooks',
  },
  stripe: {
    label: 'Stripe',
    path: '/api/webhooks/payment/stripe',
    events: ['payment_intent.succeeded', 'payment_intent.payment_failed', 'checkout.session.completed'],
    setupUrl: 'https://dashboard.stripe.com/webhooks',
  },
  cashfree: {
    label: 'Cashfree',
    path: '/api/webhooks/payment/cashfree',
    events: ['PAYMENT_SUCCESS', 'PAYMENT_FAILED'],
    setupUrl: 'https://merchant.cashfree.com/pg/developers',
  },
  phonepe: {
    label: 'PhonePe',
    path: '/api/webhooks/payment/phonepe',
    events: ['PAYMENT_SUCCESS', 'PAYMENT_FAILED'],
    setupUrl: 'https://developer.phonepe.com/',
  },
  payu: {
    label: 'PayU',
    path: '/api/webhooks/payment/payu',
    events: ['success', 'failure'],
    setupUrl: 'https://onboardinguat.payu.in/',
  },
};

function WebhookRow({ gateway, info }: { gateway: string; info: typeof WEBHOOK_DOCS[string] }) {
  const [copied, setCopied] = useState(false);
  const url = `${API_BASE}${info.path}`;

  const copy = () => {
    void navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Copied to clipboard');
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-gray-900">{info.label}</h3>
          <p className="text-xs text-gray-500 mt-0.5">Subscribe to these events in your {info.label} dashboard</p>
        </div>
        {info.setupUrl && (
          <a href={info.setupUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800 text-xs flex items-center gap-1">
            Open Dashboard <ExternalLink size={10} />
          </a>
        )}
      </div>

      <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 mb-3">
        <code className="text-xs text-gray-700 flex-1 truncate">{url}</code>
        <button onClick={copy} className="text-gray-400 hover:text-gray-700 shrink-0 transition">
          {copied ? <CheckCircle size={14} className="text-green-500" /> : <Copy size={14} />}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {info.events.map((event) => (
          <span key={event} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-mono">{event}</span>
        ))}
      </div>
    </div>
  );
}

export default function WebhooksPage() {
  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center">
          <Webhook size={20} className="text-orange-600" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Webhook URLs</h1>
          <p className="text-sm text-gray-500">Configure these webhook endpoints in your payment gateway dashboards</p>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 text-sm text-amber-800">
        <strong>Important:</strong> Add the webhook URL and the corresponding events in your payment gateway dashboard. Also set the <strong>Webhook Secret</strong> in <a href="/settings/payments" className="underline">Payment Settings</a> so signatures can be verified.
      </div>

      <div className="space-y-4">
        {Object.entries(WEBHOOK_DOCS).map(([gateway, info]) => (
          <WebhookRow key={gateway} gateway={gateway} info={info} />
        ))}
      </div>
    </div>
  );
}
