'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import api from '@/lib/api-client';
import { CheckCircle, Circle, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useWhatsAppQr } from '@/hooks/use-whatsapp-qr';

const STEPS = [
  { id: 1, title: 'Company Profile', description: 'Set your company name and timezone' },
  { id: 2, title: 'Connect WhatsApp', description: 'Scan QR code to link your WhatsApp number' },
  { id: 3, title: 'Configure AI', description: 'Connect an AI provider (Gemini, OpenAI, etc.)' },
  { id: 4, title: 'Payment Gateway', description: 'Set up Razorpay, Stripe, or another gateway (optional)' },
  { id: 5, title: 'Invite Team', description: 'Add your team members (optional)' },
  { id: 6, title: 'Done!', description: 'Your CRM is ready to use' },
];

export default function SetupPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);

  const { data: setupStatus } = useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const res = await api.get<{ data: { steps: Record<string, boolean>; setupDone: boolean } }>('/company/setup-status');
      return res.data.data;
    },
  });

  const completeMutation = useMutation({
    mutationFn: () => api.post('/company/setup-complete'),
    onSuccess: () => {
      toast.success('Setup complete! Welcome to your CRM.');
      router.push('/inbox');
    },
  });

  const stepsCompleted = setupStatus?.steps ?? {};

  return (
    <div className="min-h-full bg-gray-50 p-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Setup Wizard</h1>
          <p className="text-gray-500 mt-1">Complete these steps to get your CRM up and running.</p>
        </div>

        {/* Steps sidebar */}
        <div className="flex gap-8">
          <div className="w-64 shrink-0">
            <div className="space-y-2">
              {STEPS.map((step) => {
                const done = step.id === 1
                  ? stepsCompleted.companyProfile
                  : step.id === 2
                  ? stepsCompleted.whatsappConnected
                  : step.id === 3
                  ? stepsCompleted.aiConfigured
                  : step.id === 4
                  ? stepsCompleted.paymentConfigured
                  : step.id >= 5;

                return (
                  <button
                    key={step.id}
                    onClick={() => setCurrentStep(step.id)}
                    className={cn(
                      'w-full text-left flex items-center gap-3 px-4 py-3 rounded-lg transition',
                      currentStep === step.id
                        ? 'bg-white shadow-sm border border-gray-200'
                        : 'hover:bg-white/50',
                    )}
                  >
                    {done ? (
                      <CheckCircle size={18} className="text-green-500 shrink-0" />
                    ) : (
                      <Circle size={18} className="text-gray-300 shrink-0" />
                    )}
                    <div>
                      <p className={cn('text-sm font-medium', done ? 'text-green-700' : 'text-gray-700')}>
                        {step.title}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step content */}
          <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <StepContent step={currentStep} onNext={() => setCurrentStep((s) => Math.min(s + 1, 6))} />

            {currentStep === 6 && (
              <button
                onClick={() => completeMutation.mutate()}
                disabled={completeMutation.isPending}
                className="mt-6 w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {completeMutation.isPending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <>Go to Inbox <ChevronRight size={16} /></>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepContent({ step, onNext }: { step: number; onNext: () => void }) {
  if (step === 1) return <CompanyStep onNext={onNext} />;
  if (step === 2) return <WhatsAppStep onNext={onNext} />;
  if (step === 3) return <AiStep onNext={onNext} />;
  if (step === 4) return <PaymentStep onNext={onNext} />;
  if (step === 5) return <TeamStep onNext={onNext} />;
  return (
    <div className="text-center py-8">
      <CheckCircle size={48} className="mx-auto text-green-500 mb-4" />
      <h2 className="text-xl font-bold text-gray-900 mb-2">You&apos;re all set!</h2>
      <p className="text-gray-500">Your WhatsApp AI CRM is configured and ready.</p>
    </div>
  );
}

function CompanyStep({ onNext }: { onNext: () => void }) {
  const [name, setName] = useState('');
  const mutation = useMutation({
    mutationFn: () => api.patch('/company', { name }),
    onSuccess: () => { toast.success('Company profile saved'); onNext(); },
  });

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Company Profile</h2>
      <p className="text-gray-500 text-sm mb-6">Tell us about your company.</p>
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium text-gray-700">Company Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="Acme Corp"
          />
        </div>
        <button
          onClick={() => mutation.mutate()}
          disabled={!name || mutation.isPending}
          className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          Save & Continue
        </button>
      </div>
    </div>
  );
}

function WhatsAppStep({ onNext }: { onNext: () => void }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const { qrCode, connected, phoneNumber } = useWhatsAppQr(accountId);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: { id: string } }>('/settings/whatsapp/accounts');
      return res.data.data.id;
    },
    onSuccess: (id) => setAccountId(id),
  });

  if (connected) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-1">WhatsApp Connected</h2>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mt-4">
          <div className="flex items-center gap-3">
            <CheckCircle size={20} className="text-green-500" />
            <div>
              <p className="font-medium text-green-800">Connected!</p>
              <p className="text-sm text-green-600">{phoneNumber}</p>
            </div>
          </div>
        </div>
        <button onClick={onNext} className="mt-6 bg-green-600 text-white px-6 py-2 rounded-lg text-sm font-medium">
          Continue
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Connect WhatsApp</h2>
      <p className="text-gray-500 text-sm mb-6">Scan the QR code with your WhatsApp mobile app.</p>

      {!accountId ? (
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {createMutation.isPending ? 'Generating…' : 'Generate QR Code'}
        </button>
      ) : qrCode ? (
        <div className="text-center">
          <div className="inline-block p-4 bg-white border-2 border-gray-200 rounded-xl">
            {/* QR code would render here using a QR library */}
            <div className="w-48 h-48 bg-gray-100 rounded flex items-center justify-center text-xs text-gray-500">
              QR Code<br />(scan with WhatsApp)
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-3">Waiting for scan…</p>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Connecting…</span>
        </div>
      )}

      <button onClick={onNext} className="mt-6 text-sm text-gray-400 hover:text-gray-600 underline">
        Skip for now
      </button>
    </div>
  );
}

function AiStep({ onNext }: { onNext: () => void }) {
  const [provider, setProvider] = useState('GEMINI');
  const [model] = useState('gemini-2.5-flash');
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const providers = ['GEMINI', 'OPENAI', 'ANTHROPIC', 'GROQ', 'OLLAMA', 'OPENROUTER'];

  const saveMutation = useMutation({
    mutationFn: () => api.put('/settings/ai', { provider, model, apiKey }),
    onSuccess: () => { toast.success('AI configured'); onNext(); },
  });

  const testAi = async () => {
    setTesting(true);
    try {
      const res = await api.post<{ data: { ok: boolean; error?: string } }>('/settings/ai/test');
      setTestResult(res.data.data);
    } catch {
      setTestResult({ ok: false, error: 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Configure AI</h2>
      <p className="text-gray-500 text-sm mb-6">Connect an AI provider to power your automated responses.</p>
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium text-gray-700">AI Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {providers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="Enter your API key"
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={testAi}
            disabled={!apiKey || testing}
            className="border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!apiKey || saveMutation.isPending}
            className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            Save & Continue
          </button>
        </div>
        {testResult && (
          <div className={cn('p-3 rounded-lg text-sm', testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>
            {testResult.ok ? 'Connection successful!' : `Error: ${testResult.error}`}
          </div>
        )}
      </div>
      <button onClick={onNext} className="mt-6 text-sm text-gray-400 hover:text-gray-600 underline">Skip for now</button>
    </div>
  );
}

function PaymentStep({ onNext }: { onNext: () => void }) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Payment Gateway</h2>
      <p className="text-gray-500 text-sm mb-6">Configure a payment gateway to send payment links via WhatsApp. You can do this later in Settings.</p>
      <button onClick={onNext} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg text-sm font-medium">
        Continue
      </button>
    </div>
  );
}

function TeamStep({ onNext }: { onNext: () => void }) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Invite Team</h2>
      <p className="text-gray-500 text-sm mb-6">Add team members to collaborate. You can do this later in Settings &gt; Team.</p>
      <button onClick={onNext} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg text-sm font-medium">
        Continue
      </button>
    </div>
  );
}
