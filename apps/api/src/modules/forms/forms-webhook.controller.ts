/**
 * Custom form webhook — API-key-protected `POST /webhooks/forms/:slug`.
 *
 * For users wiring up Zapier / n8n / external form builders / curl. The
 * API key must carry the `forms:write` scope. The payload is the filled
 * form data as a flat JSON object — keys map to the form's field keys.
 *
 * Auth: `Authorization: Bearer wacrm_<key>` validated by `ApiKeyAuthGuard`.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiKeyAuthGuard } from '../../common/guards/api-key-auth.guard';
import { RequireScope } from '../../common/decorators/require-scope.decorator';
import { FormsService } from './forms.service';
import type { SubmissionMeta } from './forms.types';

interface ApiKeyRequest extends Request {
  apiKey?: { id: string; companyId: string; scopes: string[] };
  companyId?: string;
}

@ApiTags('form-webhooks')
@ApiBearerAuth()
@Controller('webhooks/forms')
@UseGuards(ApiKeyAuthGuard)
export class FormsWebhookController {
  constructor(private readonly svc: FormsService) {}

  @Post(':slug')
  @RequireScope('forms:write')
  async submit(
    @Param('slug') slug: string,
    @Body() body: Record<string, unknown>,
    @Req() req: ApiKeyRequest,
  ) {
    if (!req.companyId) {
      throw new BadRequestException('Missing company context on API key');
    }
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Body must be a JSON object');
    }
    const meta: SubmissionMeta = {
      actor: { type: 'system' },
      ipAddress:
        (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
        req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      referrer: (req.headers['referer'] ?? req.headers['referrer']) as string | undefined,
    };
    return this.svc.submit(req.companyId, slug, body, meta);
  }
}
