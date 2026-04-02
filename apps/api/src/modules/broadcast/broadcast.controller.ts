import {
  Controller, Get, Post, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BroadcastService, CreateBroadcastDto } from './broadcast.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '@wacrm/database';

@ApiTags('broadcasts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
@Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
@Controller('broadcasts')
export class BroadcastController {
  constructor(private readonly svc: BroadcastService) {}

  @Get()
  list(@CurrentUser() user: User, @Query('page') page?: number) {
    return this.svc.list(user.companyId, page);
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.get(user.companyId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create + optionally schedule a broadcast' })
  create(@CurrentUser() user: User, @Body() body: CreateBroadcastDto) {
    return this.svc.create(user.companyId, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel and delete a scheduled broadcast' })
  cancel(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.cancel(user.companyId, id);
  }
}
