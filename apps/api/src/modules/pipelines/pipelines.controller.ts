import { Controller, Get, Post, Patch, Delete, Body, Param,  UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PipelinesService } from './pipelines.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '@wacrm/database';

@ApiTags('pipelines')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('pipelines')
export class PipelinesController {
  constructor(private readonly svc: PipelinesService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.svc.list(user.companyId, {});
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.get(user.companyId, id);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() body: { name: string; isDefault?: boolean; stages?: { name: string; color?: string; sortOrder: number; probability?: number }[] }) {
    return this.svc.create(user.companyId, body);
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() body: { name?: string; isDefault?: boolean }) {
    return this.svc.update(user.companyId, id, body);
  }

  @Delete(':id')
  delete(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.delete(user.companyId, id);
  }

  @Post(':id/stages')
  addStage(@CurrentUser() user: User, @Param('id') id: string, @Body() body: { name: string; color?: string; sortOrder: number; probability?: number }) {
    return this.svc.addStage(user.companyId, id, body);
  }
}
