'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import api from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { Zap } from 'lucide-react';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});
type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      const res = await api.post<{
        data: {
          user: { id: string; email: string; firstName: string; lastName: string; role: string; companyId: string };
          accessToken: string;
          refreshToken: string;
        };
      }>('/auth/login', data);

      const { user, accessToken, refreshToken } = res.data.data;
      setAuth(user, accessToken, refreshToken);
      router.push('/chat');
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Login failed';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f0f10]">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <div className="w-8 h-8 rounded-lg bg-violet-500 flex items-center justify-center">
            <Zap size={16} className="text-white" />
          </div>
          <span className="text-white text-sm font-semibold tracking-tight">Open Agent CRM</span>
        </div>

        <div className="bg-white rounded-lg p-6 shadow-2xl shadow-black/20">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Sign in to your account</h2>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Email</label>
              <input
                {...register('email')}
                type="email"
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400 placeholder:text-gray-300"
                placeholder="admin@company.com"
              />
              {errors.email && <p className="text-red-500 text-[10px] mt-0.5">{errors.email.message}</p>}
            </div>

            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Password</label>
              <input
                {...register('password')}
                type="password"
                className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400 placeholder:text-gray-300"
                placeholder="••••••••"
              />
              {errors.password && <p className="text-red-500 text-[10px] mt-0.5">{errors.password.message}</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-md py-2 transition disabled:opacity-40 mt-1"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-[10px] text-gray-500 mt-6">
          Open Agent CRM &middot; Self-hosted &middot; AI-powered
        </p>
      </div>
    </div>
  );
}
