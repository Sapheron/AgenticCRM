/**
 * Public invoice endpoints — NO authentication, mounted at `/public/invoices`.
 *
 * Powers the hosted invoice page at `apps/dashboard/src/app/public/invoices/[token]/page.tsx`.
 * Only invoices in SENT / VIEWED / PARTIALLY_PAID / PAID / OVERDUE are
 * customer-viewable; DRAFT / CANCELLED / VOID return 404.
 *
 * No accept/reject (invoices aren't negotiable — that's what Quotes is for).
 * No payment UI in the renderer (Phase 2 — would need Stripe/Razorpay wiring).
 * The only side effect of a GET is fire-and-forget `markViewed`.
 */
import {
  Controller,
  Get,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';

@ApiTags('public-invoices')
@Controller('public/invoices')
export class PublicInvoiceController {
  constructor(private readonly svc: InvoicesService) {}

  @Get(':token')
  async get(@Param('token') token: string) {
    const def = await this.svc.getPublicByToken(token);
    if (!def) throw new NotFoundException('Invoice not found');
    // Fire-and-forget — do not block the response on the activity write.
    void this.svc.markViewed(token).catch(() => undefined);
    return def;
  }
}
