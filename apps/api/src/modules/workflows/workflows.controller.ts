import { Controller, Get, Post, Patch, Delete, Body, Param,  UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { WorkflowsService } from './workflows.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '@wacrm/database';

@ApiTags('workflows')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly svc: WorkflowsService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.svc.list(user.companyId, {});
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.get(user.companyId, id);
  }

  @Get(':id/executions')
  listExecutions(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.listExecutions(user.companyId, id);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() body: { name: string; isActive?: boolean; trigger?: any; steps?: any }) {
    return this.svc.create(user.companyId, body);
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() body: { name?: string; isActive?: boolean; trigger?: any; steps?: any }) {
    return this.svc.update(user.companyId, id, body);
  }

  @Delete(':id')
  delete(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.delete(user.companyId, id);
  }
}
