import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import type { WaAccountStatus } from '@wacrm/database';

@Injectable()
export class WhatsAppSettingsService {
  async listAccounts(companyId: string) {
    return prisma.whatsAppAccount.findMany({
      where: { companyId },
      select: {
        id: true,
        phoneNumber: true,
        displayName: true,
        status: true,
        provider: true,
        warmupStage: true,
        dailyMessageLimit: true,
        messagesSentToday: true,
        lastConnectedAt: true,
        lastErrorAt: true,
        // Never return sessionDataEnc or accessTokenEnc
      },
    });
  }

  async createAccount(companyId: string, phoneNumber?: string) {
    const id = `wa_${Math.random().toString(36).substring(2, 11)}`;
    return prisma.whatsAppAccount.create({
      data: {
        id,
        companyId,
        phoneNumber: phoneNumber || `PENDING-${id}`,
        status: 'QR_PENDING',
      },
    });
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

  async deleteAccount(companyId: string, accountId: string) {
    const account = await prisma.whatsAppAccount.findFirst({
      where: { id: accountId, companyId },
    });
    if (!account) throw new NotFoundException('Account not found');
    return prisma.whatsAppAccount.delete({ where: { id: accountId } });
  }
}
