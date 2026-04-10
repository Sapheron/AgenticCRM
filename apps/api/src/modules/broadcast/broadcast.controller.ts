import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator';
import { BroadcastService } from './broadcast.service';
import {
  type BroadcastActor,
  type CreateBroadcastDto as CreateBroadcastInput,
  type UpdateBroadcastDto as UpdateBroadcastInput,
  type ListBroadcastsFilters,
  type AudienceFilter,
} from './broadcast.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User, BroadcastStatus } from '@wacrm/database';

class ScheduleBody {
  @IsString() scheduledAt: string;
}

class AudienceBody implements AudienceFilter {
  @IsArray() @IsOptional() tags?: string[];
  @IsArray() @IsOptional() contactIds?: string[];
  @IsString() @IsOptional() lifecycleStage?: string;
  @IsNumber() @IsOptional() scoreMin?: number;
  @IsNumber() @IsOptional() scoreMax?: number;
}

class DuplicateBody {
  @IsString() @IsOptional() newName?: string;
}

class PreviewAudienceBody implements AudienceFilter {
  @IsArray() @IsOptional() tags?: string[];
  @IsArray() @IsOptional() contactIds?: string[];
  @IsString() @IsOptional() lifecycleStage?: string;
  @IsNumber() @IsOptional() scoreMin?: number;
  @IsNumber() @IsOptional() scoreMax?: number;
}

function userActor(user: User): BroadcastActor {
  return { type: 'user', userId: user.id };
}

@ApiTags('broadcasts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
@Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
@Controller('broadcasts')
export class BroadcastController {
  constructor(private readonly svc: BroadcastService) {}

  // ── Reads ──────────────────────────────────────────────────────────────

  @Get()
  list(
    @CurrentUser() user: User,
    @Query('status') status?: BroadcastStatus,
    @Query('search') search?: string,
    @Query('scheduledFrom') scheduledFrom?: string,
    @Query('scheduledTo') scheduledTo?: string,
    @Query('sort') sort?: ListBroadcastsFilters['sort'],
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.list(user.companyId, {
      status,
      search,
      scheduledFrom,
      scheduledTo,
      sort,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('stats')
  stats(@CurrentUser() user: User, @Query('days') days?: string) {
    return this.svc.stats(user.companyId, days ? Number(days) : 30);
  }

  @Post('preview-audience')
  @ApiOperation({ summary: 'Preview an audience filter without creating a broadcast' })
  previewAudience(@CurrentUser() user: User, @Body() body: PreviewAudienceBody) {
    return this.svc.previewAudienceSize(user.companyId, body);
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.get(user.companyId, id);
  }

  @Get(':id/timeline')
  timeline(@CurrentUser() user: User, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.svc.getTimeline(user.companyId, id, limit ? Number(limit) : 100);
  }

  @Get(':id/recipients')
  recipients(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.getRecipients(user.companyId, id, {
      status,
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // ── Writes ─────────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a broadcast (always starts in DRAFT)' })
  create(@CurrentUser() user: User, @Body() body: CreateBroadcastInput) {
    return this.svc.create(user.companyId, body, userActor(user));
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() body: UpdateBroadcastInput) {
    return this.svc.update(user.companyId, id, body, userActor(user));
  }

  @Post(':id/audience')
  setAudience(@CurrentUser() user: User, @Param('id') id: string, @Body() body: AudienceBody) {
    return this.svc.setAudience(user.companyId, id, body, userActor(user));
  }

  @Post(':id/schedule')
  schedule(@CurrentUser() user: User, @Param('id') id: string, @Body() body: ScheduleBody) {
    return this.svc.schedule(user.companyId, id, body.scheduledAt, userActor(user));
  }

  @Post(':id/unschedule')
  unschedule(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.unschedule(user.companyId, id, userActor(user));
  }

  @Post(':id/send-now')
  sendNow(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.sendNow(user.companyId, id, userActor(user));
  }

  @Post(':id/pause')
  pause(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.pause(user.companyId, id, userActor(user));
  }

  @Post(':id/resume')
  resume(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.resume(user.companyId, id, userActor(user));
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.cancel(user.companyId, id, userActor(user));
  }

  @Post(':id/retry-failed')
  retryFailed(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.retryFailed(user.companyId, id, userActor(user));
  }

  @Post(':id/duplicate')
  duplicate(@CurrentUser() user: User, @Param('id') id: string, @Body() body: DuplicateBody) {
    return this.svc.duplicate(user.companyId, id, userActor(user), body.newName);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.delete(user.companyId, id, userActor(user));
  }
}
