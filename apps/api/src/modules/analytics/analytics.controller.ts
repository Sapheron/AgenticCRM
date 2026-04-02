import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '@wacrm/database';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly svc: AnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Dashboard KPI stats' })
  dashboard(@CurrentUser() user: User) {
    return this.svc.getDashboardStats(user.companyId);
  }

  @Get('conversations/trend')
  conversationTrend(@CurrentUser() user: User, @Query('days') days?: number) {
    return this.svc.getConversationTrend(user.companyId, days ? Number(days) : 30);
  }

  @Get('deals/funnel')
  dealFunnel(@CurrentUser() user: User) {
    return this.svc.getDealFunnel(user.companyId);
  }

  @Get('leads/sources')
  leadSources(@CurrentUser() user: User) {
    return this.svc.getLeadSources(user.companyId);
  }

  @Get('agents/performance')
  agentPerformance(@CurrentUser() user: User) {
    return this.svc.getAgentPerformance(user.companyId);
  }
}
