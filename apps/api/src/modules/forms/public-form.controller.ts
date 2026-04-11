/**
 * Public form endpoints — NO authentication, mounted at `/public/forms`.
 *
 * These two routes power the hosted form page at
 * `apps/dashboard/src/app/public/forms/[slug]/page.tsx`:
 *
 *   GET  /public/forms/:slug              → form definition (only if isPublic && ACTIVE)
 *   POST /public/forms/:slug/submit       → ingest a submission, rate-limited by IP
 *
 * Rate limiting is enforced inside `FormsService.submit()` by counting recent
 * submissions from the same IP against `form.rateLimitPerHour`.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { prisma } from '@wacrm/database';
import { FormsService } from './forms.service';
import type { SubmissionMeta } from './forms.types';

@ApiTags('public-forms')
@Controller('public/forms')
export class PublicFormController {
  constructor(private readonly svc: FormsService) {}

  @Get(':slug')
  async get(@Param('slug') slug: string) {
    // Resolve the form WITHOUT a companyId filter — slugs are globally unique
    // enough for now (future: prepend company slug). Only return if public+active.
    const form = await prisma.form.findFirst({
      where: { slug, status: 'ACTIVE', isPublic: true },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        fields: true,
        requireCaptcha: true,
        companyId: true,
      },
    });
    if (!form) throw new NotFoundException('Form not found');
    return {
      id: form.id,
      slug: form.slug,
      name: form.name,
      description: form.description,
      fields: form.fields,
      requireCaptcha: form.requireCaptcha,
    };
  }

  @Post(':slug/submit')
  async submit(
    @Param('slug') slug: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    const form = await prisma.form.findFirst({
      where: { slug, status: 'ACTIVE', isPublic: true },
      select: { id: true, companyId: true },
    });
    if (!form) throw new NotFoundException('Form not found');
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Body must be a JSON object');
    }

    const meta: SubmissionMeta = {
      actor: { type: 'public' },
      ipAddress:
        (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
        req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      referrer: (req.headers['referer'] ?? req.headers['referrer']) as string | undefined,
      utm: {
        source: (body.utm_source as string | undefined) ?? undefined,
        medium: (body.utm_medium as string | undefined) ?? undefined,
        campaign: (body.utm_campaign as string | undefined) ?? undefined,
      },
    };
    const result = await this.svc.submit(form.companyId, form.id, body, meta);
    return { ok: result.status !== 'SPAM', ...result };
  }
}
