import { Module } from '@nestjs/common';
import { FormsController } from './forms.controller';
import { PublicFormController } from './public-form.controller';
import { FormsWebhookController } from './forms-webhook.controller';
import { FormsService } from './forms.service';
import { LeadsModule } from '../leads/leads.module';
import { ApiKeyAuthGuard } from '../../common/guards/api-key-auth.guard';

@Module({
  imports: [LeadsModule],
  controllers: [FormsController, PublicFormController, FormsWebhookController],
  providers: [FormsService, ApiKeyAuthGuard],
  exports: [FormsService],
})
export class FormsModule {}
