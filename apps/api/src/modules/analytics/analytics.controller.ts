import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { User } from '@wacrm/database';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@RequirePermissions('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly svc: AnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'KPI dashboard stats' })
  dashboard(@CurrentUser() user: User, @Query('days') days?: string) {
    return this.svc.getDashboardStats(user.companyId, days ? Number(days) : 30);
  }

  @Get('summary')
  @ApiOperation({ summary: 'One-shot CRM health summary' })
  summary(@CurrentUser() user: User) {
    return this.svc.getCrmSummary(user.companyId);
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Revenue trends over time' })
  revenue(
    @CurrentUser() user: User,
    @Query('days') days?: string,
    @Query('groupBy') groupBy?: 'day' | 'week' | 'month',
  ) {
    return this.svc.getRevenueTrends(user.companyId, days ? Number(days) : 30, groupBy ?? 'day');
  }

  @Get('funnel')
  @ApiOperation({ summary: 'Lead conversion funnel' })
  funnel(@CurrentUser() user: User, @Query('days') days?: string) {
    return this.svc.getConversionFunnel(user.companyId, days ? Number(days) : 30);
  }

  @Get('pipeline')
  @ApiOperation({ summary: 'Deal pipeline by stage' })
  pipeline(@CurrentUser() user: User) {
    return this.svc.getDealPipelineStats(user.companyId);
  }

  @Get('leads/sources')
  @ApiOperation({ summary: 'Lead source breakdown' })
  leadSources(@CurrentUser() user: User, @Query('days') days?: string) {
    return this.svc.getLeadSourceBreakdown(user.companyId, days ? Number(days) : 30);
  }

  @Get('contacts/growth')
  @ApiOperation({ summary: 'Contact growth over time' })
  contactGrowth(
    @CurrentUser() user: User,
    @Query('days') days?: string,
    @Query('groupBy') groupBy?: 'day' | 'week' | 'month',
  ) {
    return this.svc.getContactGrowth(user.companyId, days ? Number(days) : 30, groupBy ?? 'day');
  }

  @Get('agents')
  @ApiOperation({ summary: 'Agent performance metrics' })
  agents(@CurrentUser() user: User, @Query('days') days?: string) {
    return this.svc.getAgentPerformance(user.companyId, days ? Number(days) : 30);
  }

  @Get('broadcasts')
  @ApiOperation({ summary: 'Broadcast delivery stats' })
  broadcasts(@CurrentUser() user: User, @Query('days') days?: string) {
    return this.svc.getBroadcastStats(user.companyId, days ? Number(days) : 30);
  }

  @Get('messages/volume')
  @ApiOperation({ summary: 'Message volume by direction' })
  messageVolume(
    @CurrentUser() user: User,
    @Query('days') days?: string,
    @Query('groupBy') groupBy?: 'day' | 'week' | 'month',
  ) {
    return this.svc.getMessageVolumeByChannel(user.companyId, days ? Number(days) : 30, groupBy ?? 'day');
  }

  @Get('tickets')
  @ApiOperation({ summary: 'Ticket stats' })
  tickets(@CurrentUser() user: User, @Query('days') days?: string) {
    return this.svc.getTicketStats(user.companyId, days ? Number(days) : 30);
  }

  @Get('response-times')
  @ApiOperation({ summary: 'Response time stats' })
  responseTimes(@CurrentUser() user: User, @Query('days') days?: string) {
    return this.svc.getResponseTimeStats(user.companyId, days ? Number(days) : 30);
  }

  @Get('top-contacts')
  @ApiOperation({ summary: 'Top contacts by message volume' })
  topContacts(@CurrentUser() user: User, @Query('days') days?: string, @Query('limit') limit?: string) {
    return this.svc.getTopContacts(user.companyId, days ? Number(days) : 30, limit ? Number(limit) : 10);
  }

  @Get('tags')
  @ApiOperation({ summary: 'Tag usage analytics' })
  tags(@CurrentUser() user: User, @Query('days') days?: string) {
    return this.svc.getTagAnalytics(user.companyId, days ? Number(days) : 30);
  }

  @Get('compare')
  @ApiOperation({ summary: 'Compare current vs prior period' })
  compare(@CurrentUser() user: User, @Query('days') days?: string) {
    return this.svc.comparePeriods(user.companyId, days ? Number(days) : 30);
  }

  // Legacy endpoints — kept for backward compatibility
  @Get('conversations/trend')
  conversationTrend(@CurrentUser() user: User, @Query('days') days?: string) {
    return this.svc.getConversationTrend(user.companyId, days ? Number(days) : 30);
  }

  @Get('deals/funnel')
  dealFunnel(@CurrentUser() user: User) {
    return this.svc.getDealFunnel(user.companyId);
  }

  @Get('agents/performance')
  agentPerformance(@CurrentUser() user: User) {
    return this.svc.getAgentPerformance(user.companyId, 30);
  }
}
