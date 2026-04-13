import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AuthModule } from './modules/auth/auth.module';
import { CompanyModule } from './modules/company/company.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { MessagesModule } from './modules/messages/messages.module';
import { LeadsModule } from './modules/leads/leads.module';
import { LeadIntakeModule } from './modules/lead-intake/lead-intake.module';
import { DealsModule } from './modules/deals/deals.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { TeamModule } from './modules/team/team.module';
import { BroadcastModule } from './modules/broadcast/broadcast.module';
import { AiChatModule } from './modules/ai-chat/ai-chat.module';
import { ChatConversationsModule } from './modules/chat-conversations/chat-conversations.module';
import { AiMemoryModule } from './modules/ai-memory/ai-memory.module';
import { MemoryModule } from './modules/memory/memory.module';
import { TagsModule } from './modules/tags/tags.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { SequencesModule } from './modules/sequences/sequences.module';
import { PipelinesModule } from './modules/pipelines/pipelines.module';
import { ProductsModule } from './modules/products/products.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { FormsModule } from './modules/forms/forms.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { KnowledgeBaseModule } from './modules/knowledge-base/knowledge-base.module';
import { ReportsModule } from './modules/reports/reports.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { SystemModule } from './modules/system/system.module';
import { WsGatewayModule } from './gateway/ws-gateway.module';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        url: (process.env.REDIS_URL || '').trim(),
      },
    }),
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.API_RATE_LIMIT_TTL_MS ?? '60000'),
        limit: parseInt(process.env.API_RATE_LIMIT_MAX ?? '100'),
      },
    ]),
    AuthModule,
    CompanyModule,
    ContactsModule,
    ConversationsModule,
    MessagesModule,
    LeadsModule,
    LeadIntakeModule,
    DealsModule,
    TasksModule,
    PaymentsModule,
    SettingsModule,
    AnalyticsModule,
    TeamModule,
    BroadcastModule,
    AiChatModule,
    ChatConversationsModule,
    AiMemoryModule,
    MemoryModule,
    TagsModule,
    TemplatesModule,
    SequencesModule,
    PipelinesModule,
    ProductsModule,
    QuotesModule,
    InvoicesModule,
    CampaignsModule,
    FormsModule,
    WorkflowsModule,
    TicketsModule,
    KnowledgeBaseModule,
    ReportsModule,
    IntegrationsModule,
    DocumentsModule,
    ApiKeysModule,
    SystemModule,
    WsGatewayModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
  ],
})
export class AppModule {}
