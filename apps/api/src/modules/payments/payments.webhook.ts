import {
  Controller, Post, Param, Headers, Body, RawBodyRequest, Req, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { prisma } from '@wacrm/database';
import { decrypt } from '@wacrm/shared';
import { GatewayFactory } from './gateways/gateway.factory';
import { PaymentsService } from './payments.service';

@ApiTags('webhooks')
@Controller('webhooks/payment')
export class PaymentsWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post(':companyId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive payment gateway webhook' })
  async handle(
    @Param('companyId') companyId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') razorpaySignature?: string,
    @Headers('stripe-signature') stripeSignature?: string,
    @Headers('x-webhook-signature') cashfreeSignature?: string,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) return { received: true };

    const config = await prisma.paymentConfig.findUnique({ where: { companyId } });
    if (!config || config.provider === 'NONE' || !config.webhookSecret) {
      return { received: true };
    }

    const key = config.keyEncrypted ? decrypt(config.keyEncrypted) : '';
    const secret = config.secretEncrypted ? decrypt(config.secretEncrypted) : undefined;
    const gateway = GatewayFactory.create({ provider: config.provider, key, secret });

    const signature =
      razorpaySignature ?? stripeSignature ?? cashfreeSignature ?? '';

    const result = gateway.verifyWebhook(rawBody, signature, config.webhookSecret);
    await this.paymentsService.handleWebhookVerified(result.externalId, result.status, result.paidAt);

    return { received: true };
  }
}
