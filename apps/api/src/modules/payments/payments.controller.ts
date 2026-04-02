import {
  Controller, Get, Post, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PaymentsService, CreatePaymentLinkDto } from './payments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '@wacrm/database';
import { ConfigService } from '@nestjs/config';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly svc: PaymentsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: User,
    @Query('contactId') contactId?: string,
    @Query('dealId') dealId?: string,
    @Query('page') page?: number,
  ) {
    return this.svc.list(user.companyId, { contactId, dealId, page });
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.get(user.companyId, id);
  }

  @Post('link')
  @ApiOperation({ summary: 'Create a payment link and store in DB' })
  createLink(@CurrentUser() user: User, @Body() body: CreatePaymentLinkDto) {
    return this.svc.createLink(user.companyId, body);
  }

  @Get('webhook-url')
  @ApiOperation({ summary: 'Get the webhook URL to configure in the payment gateway dashboard' })
  webhookUrl(@CurrentUser() user: User) {
    const domain = this.config.get<string>('DOMAIN') ?? 'localhost:3000';
    return this.svc.getWebhookUrl(user.companyId, domain);
  }
}
