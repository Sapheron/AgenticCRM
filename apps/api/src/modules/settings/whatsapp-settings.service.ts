import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import type { WaAccountStatus, User, UserRole } from '@wacrm/database';
import Redis from 'ioredis';

const WA_COMMAND_CHANNEL = 'wa:command';

@Injectable()
export class WhatsAppSettingsService {
  private readonly logger = new Logger(WhatsAppSettingsService.name);
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis((process.env.REDIS_URL || '').trim());
  }

  async listAccounts(companyId: string, user: User) {
    const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
    const where: { companyId: string; userId?: string } = { companyId };

    // Non-admin users only see their own WhatsApp accounts
    if (!isAdmin) {
      where.userId = user.id;
    }

    return prisma.whatsAppAccount.findMany({
      where,
      select: {
        id: true,
        phoneNumber: true,
        displayName: true,
        status: true,
        lastConnectedAt: true,
        userId: true,
        allowedNumbers: true,
        user: isAdmin
          ? { select: { id: true, firstName: true, lastName: true, email: true } }
          : false,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAccount(companyId: string, userId: string, phoneNumber?: string) {
    const id = `wa_${Math.random().toString(36).substring(2, 11)}`;
    const account = await prisma.whatsAppAccount.create({
      data: {
        id,
        companyId,
        userId,
        phoneNumber: phoneNumber || `PENDING-${id}`,
        status: 'QR_PENDING',
      },
    });

    // Tell WhatsApp service to start a Baileys session for this account
    await this.publishCommand('start', id);
    return account;
  }

  async reconnectAccount(companyId: string, accountId: string, userId: string) {
    const account = await prisma.whatsAppAccount.findFirst({
      where: { id: accountId, companyId },
    });
    if (!account) throw new NotFoundException('Account not found');

    // Non-admin users can only reconnect their own accounts
    if (account.userId && account.userId !== userId) {
      throw new NotFoundException('Account not found');
    }

    await prisma.whatsAppAccount.update({
      where: { id: accountId },
      data: { status: 'QR_PENDING', qrCode: null },
    });

    // Tell WhatsApp service to restart this session
    await this.publishCommand('start', accountId);
    return { message: 'Reconnecting…' };
  }

  async updateStatus(accountId: string, status: WaAccountStatus, qrCode?: string) {
    return prisma.whatsAppAccount.update({
      where: { id: accountId },
      data: {
        status,
        qrCode: qrCode ?? null,
        ...(status === 'CONNECTED' ? { lastConnectedAt: new Date(), warmupStartedAt: new Date(), consecutiveErrors: 0 } : {}),
      },
    });
  }

  async deleteAccount(companyId: string, accountId: string, userId: string, userRole: UserRole) {
    const account = await prisma.whatsAppAccount.findFirst({
      where: { id: accountId, companyId },
    });
    if (!account) throw new NotFoundException('Account not found');

    // Non-admin users can only delete their own accounts
    const isAdmin = userRole === 'SUPER_ADMIN' || userRole === 'ADMIN';
    if (!isAdmin && account.userId !== userId) {
      throw new NotFoundException('Account not found');
    }

    // Tell WhatsApp service to stop this session before deleting
    await this.publishCommand('stop', accountId);

    // Delete related records first (foreign key constraints)
    await prisma.message.deleteMany({ where: { whatsappAccountId: accountId } });
    await prisma.conversation.deleteMany({ where: { whatsappAccountId: accountId } });

    return prisma.whatsAppAccount.delete({ where: { id: accountId } });
  }

  async updateAllowedNumbers(companyId: string, accountId: string, numbers: string[]) {
    const account = await prisma.whatsAppAccount.findFirst({
      where: { id: accountId, companyId },
    });
    if (!account) throw new NotFoundException('Account not found');

    // Normalize all numbers to E.164 without '+' (consistent with how Baileys stores them)
    const normalized = numbers
      .map((n) => n.replace(/[\s\-\(\)\.]/g, ''))  // strip formatting
      .map((n) => n.replace(/^\+/, ''))              // strip leading +
      .map((n) => {
        // If it's only digits and looks like a local number without country code,
        // prefix with 91 (India) as a sensible default for this CRM
        if (/^\d+$/.test(n) && n.length <= 10) return `91${n}`;
        return n;
      })
      .filter((n) => /^\d{7,15}$/.test(n));          // valid E.164 range

    // Deduplicate
    const unique = [...new Set(normalized)];

    await prisma.whatsAppAccount.update({
      where: { id: accountId },
      data: { allowedNumbers: unique },
    });

    return { allowedNumbers: unique };
  }

  private async publishCommand(command: 'start' | 'stop', accountId: string) {
    const payload = JSON.stringify({ command, accountId });
    await this.redis.publish(WA_COMMAND_CHANNEL, payload);
    this.logger.log(`Published ${command} command for account ${accountId}`);
  }
}
