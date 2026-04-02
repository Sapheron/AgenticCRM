import { createHmac } from 'crypto';
import type { PaymentGateway, CreatePaymentLinkOptions, PaymentLinkResult, WebhookVerifyResult } from './gateway.interface';

export class RazorpayGateway implements PaymentGateway {
  readonly provider = 'razorpay';

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
  ) {}

  private get authHeader(): string {
    return `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`;
  }

  async createPaymentLink(opts: CreateCreatePaymentLinkOptions): Promise<PaymentLinkResult> {
    const response = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        'Idempotency-Key': opts.idempotencyKey,
      },
      body: JSON.stringify({
        amount: opts.amount,
        currency: opts.currency,
        description: opts.description,
        customer: {
          name: opts.contactName,
          contact: opts.contactPhone,
          email: opts.contactEmail,
        },
        callback_url: opts.callbackUrl,
        callback_method: 'get',
        expire_by: Math.floor(Date.now() / 1000) + 86400 * 7, // 7 days
      }),
    });

    if (!response.ok) {
      const err = await response.json() as { error?: { description?: string } };
      throw new Error(err.error?.description ?? 'Razorpay API error');
    }

    const data = await response.json() as { id: string; short_url: string; expire_by?: number };
    return {
      externalId: data.id,
      linkUrl: data.short_url,
      expiresAt: data.expire_by ? new Date(data.expire_by * 1000) : undefined,
    };
  }

  verifyWebhook(payload: Buffer, signature: string, secret: string): WebhookVerifyResult {
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    if (expected !== signature) throw new Error('Invalid Razorpay webhook signature');

    const body = JSON.parse(payload.toString()) as {
      event: string;
      payload: { payment_link: { entity: { id: string; amount: number; currency: string } }; payment?: { entity?: { created_at?: number } } };
    };

    const entity = body.payload.payment_link.entity;
    const statusMap: Record<string, 'PAID' | 'FAILED'> = {
      'payment_link.paid': 'PAID',
      'payment_link.expired': 'FAILED',
    };

    return {
      externalId: entity.id,
      status: statusMap[body.event] ?? 'FAILED',
      amount: entity.amount,
      currency: entity.currency,
      paidAt: body.event === 'payment_link.paid' ? new Date() : undefined,
    };
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch('https://api.razorpay.com/v1/payments?count=1', {
        headers: { Authorization: this.authHeader },
      });
      return { ok: res.ok };
    } catch (e: unknown) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

// Fix typo in createPaymentLink param type
type CreateCreatePaymentLinkOptions = CreatePaymentLinkOptions;
