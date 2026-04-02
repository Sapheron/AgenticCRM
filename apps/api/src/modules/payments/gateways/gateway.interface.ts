export interface CreatePaymentLinkOptions {
  amount: number;       // in smallest unit (paise/cents)
  currency: string;
  description: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  idempotencyKey: string;
  callbackUrl?: string;
}

export interface PaymentLinkResult {
  externalId: string;
  linkUrl: string;
  expiresAt?: Date;
}

export interface WebhookVerifyResult {
  externalId: string;
  status: 'PAID' | 'FAILED' | 'REFUNDED';
  amount?: number;
  currency?: string;
  paidAt?: Date;
}

export interface PaymentGateway {
  readonly provider: string;

  /** Create a payment link and return the URL */
  createPaymentLink(opts: CreatePaymentLinkOptions): Promise<PaymentLinkResult>;

  /** Verify webhook signature and parse payload */
  verifyWebhook(payload: Buffer, signature: string, secret: string): WebhookVerifyResult;

  /** Test connection with current credentials */
  testConnection(): Promise<{ ok: boolean; error?: string }>;
}
