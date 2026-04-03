import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { CompanyModule } from './modules/company/company.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { MessagesModule } from './modules/messages/messages.module';
import { LeadsModule } from './modules/leads/leads.module';
import { DealsModule } from './modules/deals/deals.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { TeamModule } from './modules/team/team.module';
import { BroadcastModule } from './modules/broadcast/broadcast.module';
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
    DealsModule,
    TasksModule,
    PaymentsModule,
    SettingsModule,
    AnalyticsModule,
    TeamModule,
    BroadcastModule,
    WsGatewayModule,
  ],
})
export class AppModule {}
