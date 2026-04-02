import { createHmac } from 'crypto';
import type { PaymentGateway, CreatePaymentLinkOptions, PaymentLinkResult, WebhookVerifyResult } from './gateway.interface';

export class CashfreeGateway implements PaymentGateway {
  readonly provider = 'cashfree';

  constructor(
    private readonly appId: string,
    private readonly secretKey: string,
    private readonly testMode = false,
  ) {}

  private get baseUrl(): string {
    return this.testMode ? 'https://sandbox.cashfree.com/pg' : 'https://api.cashfree.com/pg';
  }

  async createPaymentLink(opts: CreatePaymentLinkOptions): Promise<PaymentLinkResult> {
    const response = await fetch(`${this.baseUrl}/links`, {
      method: 'POST',
      headers: {
        'x-api-version': '2022-09-01',
        'x-client-id': this.appId,
        'x-client-secret': this.secretKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        link_id: opts.idempotencyKey,
        link_amount: opts.amount / 100, // Cashfree uses rupees not paise
        link_currency: opts.currency,
        link_purpose: opts.description,
        customer_details: {
          customer_phone: opts.contactPhone ?? '9999999999',
          customer_name: opts.contactName,
          customer_email: opts.contactEmail,
        },
        link_expiry_time: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
        link_notify: { send_sms: false, send_email: false },
      }),
    });

    if (!response.ok) {
      const err = await response.json() as { message?: string };
      throw new Error(err.message ?? 'Cashfree API error');
    }

    const data = await response.json() as { link_id: string; link_url: string; link_expiry_time?: string };
    return {
      externalId: data.link_id,
      linkUrl: data.link_url,
      expiresAt: data.link_expiry_time ? new Date(data.link_expiry_time) : undefined,
    };
  }

  verifyWebhook(payload: Buffer, signature: string, secret: string): WebhookVerifyResult {
    const body = JSON.parse(payload.toString()) as {
      data: { payment?: { payment_status: string; cf_payment_id: string; payment_amount: number; payment_currency: string; payment_time?: string }; link?: { link_id: string } };
      type: string;
    };

    const payment = body.data.payment;
    const linkId = body.data.link?.link_id ?? payment?.cf_payment_id ?? '';

    const statusMap: Record<string, 'PAID' | 'FAILED'> = {
      SUCCESS: 'PAID',
      FAILED: 'FAILED',
      USER_DROPPED: 'FAILED',
    };

    return {
      externalId: linkId,
      status: statusMap[payment?.payment_status ?? ''] ?? 'FAILED',
      amount: payment ? payment.payment_amount * 100 : undefined,
      currency: payment?.payment_currency,
      paidAt: payment?.payment_status === 'SUCCESS' ? new Date(payment.payment_time ?? Date.now()) : undefined,
    };
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/links?count=1`, {
        headers: {
          'x-api-version': '2022-09-01',
          'x-client-id': this.appId,
          'x-client-secret': this.secretKey,
        },
      });
      return { ok: res.ok };
    } catch (e: unknown) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
