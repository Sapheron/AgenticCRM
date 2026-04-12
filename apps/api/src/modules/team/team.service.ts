import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import type { UserRole } from '@wacrm/database';
import * as bcrypt from 'bcryptjs';

export interface CreateMemberDto {
  email: string;
  firstName: string;
  lastName: string;
  /** Admin sets the password directly — no invite flow. */
  password: string;
  role?: UserRole;
}

@Injectable()
export class TeamService {
  async list(companyId: string) {
    return prisma.user.findMany({
      where: { companyId, isActive: true },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        role: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(companyId: string, id: string) {
    const user = await prisma.user.findFirst({
      where: { id, companyId, isActive: true },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        role: true,
        lastLoginAt: true,
        createdAt: true,
        _count: {
          select: {
            assignedConvs: { where: { status: { in: ['OPEN', 'HUMAN_HANDLING', 'WAITING_HUMAN'] } } },
            assignedTasks: { where: { status: { in: ['TODO', 'IN_PROGRESS'] } } },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('Team member not found');
    return user;
  }

  /**
   * Create a team member directly. The admin sets the email + password.
   * No invite email, no temp password — the admin communicates the
   * credentials to the team member out-of-band.
   */
  async createMember(companyId: string, dto: CreateMemberDto) {
    if (!dto.email?.trim()) throw new ConflictException('Email is required');
    if (!dto.password || dto.password.length < 6) {
      throw new ConflictException('Password must be at least 6 characters');
    }

    const existing = await prisma.user.findUnique({
      where: { companyId_email: { companyId, email: dto.email.trim().toLowerCase() } },
    });
    if (existing) throw new ConflictException('User already exists in this company');

    const passwordHash = await bcrypt.hash(dto.password, 12);

    return prisma.user.create({
      data: {
        companyId,
        email: dto.email.trim().toLowerCase(),
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        passwordHash,
        role: dto.role ?? 'AGENT',
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
      },
    });
  }

  async updateRole(companyId: string, targetUserId: string, role: UserRole, requestingUserId: string) {
    if (targetUserId === requestingUserId) {
      throw new ForbiddenException('Cannot change your own role');
    }
    await this.get(companyId, targetUserId); // throws NotFoundException if not found
    return prisma.user.update({
      where: { id: targetUserId },
      data: { role },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });
  }

  async deactivate(companyId: string, targetUserId: string, requestingUserId: string) {
    if (targetUserId === requestingUserId) {
      throw new ForbiddenException('Cannot deactivate yourself');
    }
    await this.get(companyId, targetUserId);
    return prisma.user.update({
      where: { id: targetUserId },
      data: { isActive: false },
      select: { id: true, email: true, isActive: true },
    });
  }

  async updateProfile(userId: string, dto: { firstName?: string; lastName?: string; avatarUrl?: string }) {
    return prisma.user.update({
      where: { id: userId },
      data: dto,
      select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true, role: true },
    });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new ForbiddenException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { success: true };
  }
}
