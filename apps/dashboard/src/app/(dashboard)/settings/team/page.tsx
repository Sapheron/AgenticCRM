'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api-client';
import { toast } from 'sonner';
import { Users, UserPlus, Trash2, Crown, Shield, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TeamMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  avatarUrl?: string;
  lastLoginAt?: string;
  createdAt: string;
}

const ROLE_ICONS: Record<string, React.ElementType> = { SUPER_ADMIN: Crown, ADMIN: Shield, MANAGER: Shield, AGENT: User };
const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-100 text-purple-700',
  ADMIN: 'bg-blue-100 text-blue-700',
  MANAGER: 'bg-orange-100 text-orange-700',
  AGENT: 'bg-gray-100 text-gray-600',
};
const ROLES = ['AGENT', 'MANAGER', 'ADMIN'];

export default function TeamSettingsPage() {
  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState('AGENT');
  const qc = useQueryClient();

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: async () => {
      const res = await api.get<{ data: TeamMember[] }>('/team');
      return res.data.data;
    },
  });

  const inviteMutation = useMutation({
    mutationFn: () => api.post('/team/invite', { email, firstName, lastName, role }),
    onSuccess: (res: { data: { data: { tempPassword?: string } } }) => {
      void qc.invalidateQueries({ queryKey: ['team'] });
      const tp = res.data.data.tempPassword;
      toast.success(tp ? `Invited! Temp password: ${tp}` : 'Invitation sent');
      setShowInvite(false);
      setEmail(''); setFirstName(''); setLastName(''); setRole('AGENT');
    },
    onError: () => toast.error('Failed to invite member'),
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => api.patch(`/team/${id}/role`, { role }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['team'] }); toast.success('Role updated'); },
    onError: () => toast.error('Failed to update role'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/team/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['team'] }); toast.success('Member removed'); },
    onError: () => toast.error('Failed to remove member'),
  });

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
            <Users size={20} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Team</h1>
            <p className="text-sm text-gray-500">Manage team members and their roles</p>
          </div>
        </div>
        <button onClick={() => setShowInvite(!showInvite)} className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <UserPlus size={14} />
          Invite Member
        </button>
      </div>

      {showInvite && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
          <h3 className="font-semibold text-gray-900 mb-4">Invite Team Member</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-sm font-medium text-gray-700">First Name</label>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Last Name</label>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>
          <div className="mb-3">
            <label className="text-sm font-medium text-gray-700">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div className="mb-4">
            <label className="text-sm font-medium text-gray-700">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <button onClick={() => inviteMutation.mutate()} disabled={!email || !firstName || inviteMutation.isPending} className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {inviteMutation.isPending ? 'Inviting…' : 'Send Invite'}
            </button>
            <button onClick={() => setShowInvite(false)} className="border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Loading…</div>
        ) : members.map((member) => {
          const RoleIcon = ROLE_ICONS[member.role] ?? User;
          return (
            <div key={member.id} className="flex items-center gap-4 p-4">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-blue-500 flex items-center justify-center text-white font-semibold text-sm">
                {member.firstName[0]}{member.lastName[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{member.firstName} {member.lastName}</p>
                <p className="text-xs text-gray-500">{member.email}</p>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={member.role}
                  onChange={(e) => updateRoleMutation.mutate({ id: member.id, role: e.target.value })}
                  className={cn('text-xs px-2 py-1 rounded-full border-0 font-medium cursor-pointer', ROLE_COLORS[member.role] ?? 'bg-gray-100')}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <button onClick={() => deactivateMutation.mutate(member.id)} className="text-gray-300 hover:text-red-500 transition p-1">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
