import { Controller, Get, Post, Patch, Delete, Body, Param,  UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '@wacrm/database';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.svc.list(user.companyId, {});
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.get(user.companyId, id);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() body: { name: string; entity: string; filters?: any; groupBy?: string; columns?: string[] }) {
    return this.svc.create(user.companyId, body);
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() body: { name?: string; entity?: string; filters?: any; groupBy?: string; columns?: string[] }) {
    return this.svc.update(user.companyId, id, body);
  }

  @Delete(':id')
  delete(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.delete(user.companyId, id);
  }

  @Post(':id/schedule')
  schedule(@CurrentUser() user: User, @Param('id') id: string, @Body() body: { frequency?: string; recipients: string[]; isActive?: boolean }) {
    return this.svc.schedule(user.companyId, id, body);
  }

  @Get('scheduled/all')
  listScheduled(@CurrentUser() user: User) {
    return this.svc.listScheduled(user.companyId);
  }
}
