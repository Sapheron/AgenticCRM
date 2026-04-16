import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsArray, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { LeadsService } from './leads.service';
import {
  type CreateLeadDto as CreateLeadInput,
  type UpdateLeadDto as UpdateLeadInput,
  type ListLeadsFilters,
  type ConvertLeadDto,
  type LeadActor,
} from './leads.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { User, LeadStatus, LeadSource, LeadPriority, LeadActivityType } from '@wacrm/database';

const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'NEGOTIATING', 'WON', 'LOST', 'DISQUALIFIED'] as const;

class UpdateStatusBody {
  @IsEnum(LEAD_STATUSES) status: LeadStatus;
  @IsString() @IsOptional() reason?: string;
}

class AssignBody {
  @IsString() @IsOptional() userId?: string | null;
}

class NoteBody {
  @IsString() body: string;
}

class ActivityBody {
  @IsString() type: LeadActivityType;
  @IsString() title: string;
  @IsString() @IsOptional() body?: string;
}

class ScoreBody {
  @IsInt() delta: number;
  @IsString() reason: string;
}

class BulkStatusBody {
  @IsArray() @IsString({ each: true }) ids: string[];
  @IsEnum(LEAD_STATUSES) status: LeadStatus;
  @IsString() @IsOptional() reason?: string;
}

class BulkAssignBody {
  @IsArray() @IsString({ each: true }) ids: string[];
  @IsString() @IsOptional() userId?: string | null;
}

class BulkIdsBody {
  @IsArray() @IsString({ each: true }) ids: string[];
}

class BulkTagBody {
  @IsArray() @IsString({ each: true }) ids: string[];
  @IsArray() @IsOptional() add?: string[];
  @IsArray() @IsOptional() remove?: string[];
}

class FindDuplicatesBody {
  @IsString() contactId: string;
}

function userActor(user: User): LeadActor {
  return { type: 'user', userId: user.id };
}

@ApiTags('leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@RequirePermissions('leads')
@Controller('leads')
export class LeadsController {
  constructor(private readonly svc: LeadsService) {}

  // ── Reads ──────────────────────────────────────────────────────────────

  @Get()
  list(
    @CurrentUser() user: User,
    @Query('status') status?: LeadStatus,
    @Query('source') source?: LeadSource,
    @Query('priority') priority?: LeadPriority,
    @Query('assignedAgentId') assignedAgentId?: string,
    @Query('contactId') contactId?: string,
    @Query('tag') tag?: string,
    @Query('scoreMin') scoreMin?: string,
    @Query('scoreMax') scoreMax?: string,
    @Query('valueMin') valueMin?: string,
    @Query('valueMax') valueMax?: string,
    @Query('createdFrom') createdFrom?: string,
    @Query('createdTo') createdTo?: string,
    @Query('nextActionDue') nextActionDue?: string,
    @Query('search') search?: string,
    @Query('sort') sort?: ListLeadsFilters['sort'],
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.list(user.companyId, {
      status,
      source,
      priority,
      assignedAgentId: assignedAgentId === 'null' ? null : assignedAgentId,
      contactId,
      tag,
      scoreMin: scoreMin ? Number(scoreMin) : undefined,
      scoreMax: scoreMax ? Number(scoreMax) : undefined,
      valueMin: valueMin ? Number(valueMin) : undefined,
      valueMax: valueMax ? Number(valueMax) : undefined,
      createdFrom,
      createdTo,
      nextActionDue: nextActionDue === 'true',
      search,
      sort,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('stats')
  stats(@CurrentUser() user: User, @Query('days') days?: string) {
    return this.svc.stats(user.companyId, days ? Number(days) : 30);
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.get(user.companyId, id);
  }

  @Get(':id/timeline')
  timeline(@CurrentUser() user: User, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.svc.getTimeline(user.companyId, id, limit ? Number(limit) : 100);
  }

  @Get(':id/score-history')
  scoreHistory(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.getScoreHistory(user.companyId, id);
  }

  // ── Writes ─────────────────────────────────────────────────────────────

  @Post()
  create(@CurrentUser() user: User, @Body() body: CreateLeadInput) {
    return this.svc.create(user.companyId, body, userActor(user));
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() body: UpdateLeadInput) {
    return this.svc.update(user.companyId, id, body, userActor(user));
  }

  @Post(':id/status')
  @ApiOperation({ summary: 'Update lead status (WON/LOST/QUALIFIED/etc.)' })
  updateStatus(@CurrentUser() user: User, @Param('id') id: string, @Body() body: UpdateStatusBody) {
    return this.svc.updateStatus(user.companyId, id, body.status, userActor(user), body.reason);
  }

  @Post(':id/assign')
  assign(@CurrentUser() user: User, @Param('id') id: string, @Body() body: AssignBody) {
    return this.svc.assign(user.companyId, id, body.userId ?? null, userActor(user));
  }

  @Post(':id/notes')
  addNote(@CurrentUser() user: User, @Param('id') id: string, @Body() body: NoteBody) {
    return this.svc.addNote(user.companyId, id, body.body, userActor(user));
  }

  @Patch(':id/notes/:activityId')
  @ApiOperation({ summary: 'Edit a lead note (activity of type NOTE_ADDED)' })
  updateNote(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('activityId') activityId: string,
    @Body() body: NoteBody,
  ) {
    return this.svc.updateNote(user.companyId, id, activityId, body.body, userActor(user));
  }

  @Delete(':id/notes/:activityId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a lead note (soft-delete)' })
  deleteNote(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('activityId') activityId: string,
  ) {
    return this.svc.deleteNote(user.companyId, id, activityId, userActor(user));
  }

  @Post(':id/activities')
  addActivity(@CurrentUser() user: User, @Param('id') id: string, @Body() body: ActivityBody) {
    return this.svc.addActivity(user.companyId, id, body, userActor(user));
  }

  @Post(':id/score')
  setScore(@CurrentUser() user: User, @Param('id') id: string, @Body() body: ScoreBody) {
    return this.svc.setScore(user.companyId, id, body.delta, body.reason, 'manual', userActor(user));
  }

  @Post(':id/recalculate')
  recalculate(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.recalculateScore(user.companyId, id);
  }

  @Post(':id/convert')
  convert(@CurrentUser() user: User, @Param('id') id: string, @Body() body: ConvertLeadDto) {
    return this.svc.convertToDeal(user.companyId, id, body, userActor(user));
  }

  @Post('find-duplicates')
  findDuplicates(@CurrentUser() user: User, @Body() body: FindDuplicatesBody) {
    return this.svc.findDuplicates(user.companyId, body.contactId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.remove(user.companyId, id, userActor(user));
  }

  // ── Bulk ──────────────────────────────────────────────────────────────

  @Post('bulk/status')
  bulkStatus(@CurrentUser() user: User, @Body() body: BulkStatusBody) {
    return this.svc.bulkUpdateStatus(user.companyId, body.ids, body.status, userActor(user), body.reason);
  }

  @Post('bulk/assign')
  bulkAssign(@CurrentUser() user: User, @Body() body: BulkAssignBody) {
    return this.svc.bulkAssign(user.companyId, body.ids, body.userId ?? null, userActor(user));
  }

  @Post('bulk/delete')
  bulkDelete(@CurrentUser() user: User, @Body() body: BulkIdsBody) {
    return this.svc.bulkDelete(user.companyId, body.ids, userActor(user));
  }

  @Post('bulk/tag')
  bulkTag(@CurrentUser() user: User, @Body() body: BulkTagBody) {
    return this.svc.bulkTag(user.companyId, body.ids, body.add ?? [], body.remove ?? [], userActor(user));
  }
}
