import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { PublicInvoiceController } from './public-invoice.controller';
import { InvoicesService } from './invoices.service';

@Module({
  controllers: [InvoicesController, PublicInvoiceController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
