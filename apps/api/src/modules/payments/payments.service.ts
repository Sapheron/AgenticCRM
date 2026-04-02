import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import { decrypt } from '@wacrm/shared';
import { GatewayFactory } from './gateways/gateway.factory';
import { randomUUID } from 'crypto';

export interface CreatePaymentLinkDto {
  contactId: string;
  dealId?: string;
  amount: number;       // in smallest unit (paise/cents)
  currency?: string;
  description: string;
}

@Injectable()
export class PaymentsService {
  private async getGateway(companyId: string) {
    const config = await prisma.paymentConfig.findUnique({ where: { companyId } });
    if (!config || config.provider === 'NONE') {
      throw new BadRequestException('Payment gateway not configured');
    }

    const key = config.keyEncrypted ? decrypt(config.keyEncrypted) : '';
    const secret = config.secretEncrypted ? decrypt(config.secretEncrypted) : undefined;

    return {
      gateway: GatewayFactory.create({ provider: config.provider, key, secret, testMode: config.testMode }),
      config,
    };
  }

  async list(companyId: string, opts: { contactId?: string; dealId?: string; page?: number }) {
    const page = opts.page ?? 1;
    const limit = 20;
    const where = {
      companyId,
      ...(opts.contactId ? { contactId: opts.contactId } : {}),
      ...(opts.dealId ? { dealId: opts.dealId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          contact: { select: { id: true, displayName: true, phoneNumber: true } },
          deal: { select: { id: true, title: true, stage: true } },
        },
      }),
      prisma.payment.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async get(companyId: string, id: string) {
    const payment = await prisma.payment.findFirst({ where: { id, companyId } });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async createLink(companyId: string, dto: CreatePaymentLinkDto) {
    const { gateway, config } = await this.getGateway(companyId);
    const idempotencyKey = randomUUID();

    // Fetch contact details for gateway
    const contact = await prisma.contact.findFirst({
      where: { id: dto.contactId, companyId },
      select: { displayName: true, phoneNumber: true, email: true },
    });

    const result = await gateway.createPaymentLink({
      amount: dto.amount,
      currency: dto.currency ?? config.currency,
      description: dto.description,
      contactName: contact?.displayName ?? undefined,
      contactPhone: contact?.phoneNumber ?? undefined,
      contactEmail: contact?.email ?? undefined,
      idempotencyKey,
    });

    return prisma.payment.create({
      data: {
        companyId,
        contactId: dto.contactId,
        dealId: dto.dealId,
        provider: config.provider,
        externalId: result.externalId,
        linkUrl: result.linkUrl,
        amount: dto.amount,
        currency: dto.currency ?? config.currency,
        description: dto.description,
        status: 'PENDING',
        idempotencyKey,
      },
    });
  }

  /** Called by webhook handler after signature verification */
  async handleWebhookVerified(
    externalId: string,
    status: 'PAID' | 'FAILED' | 'REFUNDED',
    paidAt?: Date,
  ) {
    const payment = await prisma.payment.findFirst({ where: { externalId } });
    if (!payment) return; // unknown payment, ignore

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status,
        paidAt: status === 'PAID' ? (paidAt ?? new Date()) : undefined,
        refundedAt: status === 'REFUNDED' ? new Date() : undefined,
      },
    });

    // If payment is for a deal, move deal to WON
    if (status === 'PAID' && payment.dealId) {
      await prisma.deal.update({
        where: { id: payment.dealId },
        data: { stage: 'WON', wonAt: new Date(), probability: 100 },
      });
    }

    return payment;
  }

  async getWebhookUrl(companyId: string, domain: string) {
    return `https://${domain}/api/webhooks/payment/${companyId}`;
  }
}
