import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsArray, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { TasksService } from './tasks.service';
import {
  type CreateTaskDto as CreateTaskInput,
  type UpdateTaskDto as UpdateTaskInput,
  type ListTasksFilters,
  type AddCommentDto,
  type CreateRecurrenceDto,
  type TaskActor,
} from './tasks.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type {
  User,
  TaskStatus,
  TaskPriority,
  TaskSource,
  TaskRecurrenceFrequency,
} from '@wacrm/database';

const STATUSES = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM_DAYS'] as const;

class UpdateStatusBody {
  @IsEnum(STATUSES) status: TaskStatus;
  @IsString() @IsOptional() reason?: string;
}

class AssignBody {
  @IsString() @IsOptional() userId?: string | null;
}

class CommentBody implements AddCommentDto {
  @IsString() body: string;
  @IsArray() @IsOptional() mentions?: string[];
}

class RescheduleBody {
  @IsString() dueAt: string;
  @IsString() @IsOptional() reason?: string;
}

class SnoozeBody {
  @IsNumber() minutes: number;
}

class LogTimeBody {
  @IsNumber() hours: number;
  @IsString() @IsOptional() note?: string;
}

class ReminderOffsetsBody {
  @IsArray() offsets: number[];
}

class WatcherBody {
  @IsString() userId: string;
}

class BulkStatusBody {
  @IsArray() @IsString({ each: true }) ids: string[];
  @IsEnum(STATUSES) status: TaskStatus;
}

class BulkAssignBody {
  @IsArray() @IsString({ each: true }) ids: string[];
  @IsString() @IsOptional() userId?: string | null;
}

class BulkSnoozeBody {
  @IsArray() @IsString({ each: true }) ids: string[];
  @IsNumber() minutes: number;
}

class BulkIdsBody {
  @IsArray() @IsString({ each: true }) ids: string[];
}

class BulkTagBody {
  @IsArray() @IsString({ each: true }) ids: string[];
  @IsArray() @IsOptional() add?: string[];
  @IsArray() @IsOptional() remove?: string[];
}

class CreateRecurrenceBody implements CreateRecurrenceDto {
  @IsString() templateTitle: string;
  @IsString() @IsOptional() templateBody?: string;
  @IsEnum(PRIORITIES) @IsOptional() templatePriority?: TaskPriority;
  @IsString() @IsOptional() templateAssignedAgentId?: string;
  @IsEnum(FREQUENCIES) frequency: TaskRecurrenceFrequency;
  @IsNumber() @IsOptional() intervalDays?: number;
  @IsArray() @IsOptional() daysOfWeek?: number[];
  @IsNumber() @IsOptional() dayOfMonth?: number;
  @IsString() startsAt: string;
  @IsString() @IsOptional() endsAt?: string;
}

function userActor(user: User): TaskActor {
  return { type: 'user', userId: user.id };
}

@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly svc: TasksService) {}

  // ── Reads ──────────────────────────────────────────────────────────────

  @Get()
  list(
    @CurrentUser() user: User,
    @Query('status') status?: TaskStatus,
    @Query('priority') priority?: TaskPriority,
    @Query('source') source?: TaskSource,
    @Query('assignedAgentId') assignedAgentId?: string,
    @Query('assignedToMe') assignedToMe?: string,
    @Query('contactId') contactId?: string,
    @Query('dealId') dealId?: string,
    @Query('leadId') leadId?: string,
    @Query('parentTaskId') parentTaskId?: string,
    @Query('topLevel') topLevel?: string,
    @Query('tag') tag?: string,
    @Query('dueFrom') dueFrom?: string,
    @Query('dueTo') dueTo?: string,
    @Query('overdue') overdue?: string,
    @Query('search') search?: string,
    @Query('includeCancelled') includeCancelled?: string,
    @Query('sort') sort?: ListTasksFilters['sort'],
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.list(user.companyId, {
      status,
      priority,
      source,
      assignedAgentId: assignedToMe === 'true' ? user.id : (assignedAgentId === 'null' ? null : assignedAgentId),
      contactId,
      dealId,
      leadId,
      parentTaskId: topLevel === 'true' ? null : parentTaskId,
      tag,
      dueFrom,
      dueTo,
      overdue: overdue === 'true',
      search,
      includeCancelled: includeCancelled === 'true',
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

  @Get(':id/comments')
  comments(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.getComments(user.companyId, id);
  }

  @Get(':id/subtasks')
  subtasks(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.getSubtasks(user.companyId, id);
  }

  // ── Writes ─────────────────────────────────────────────────────────────

  @Post()
  create(@CurrentUser() user: User, @Body() body: CreateTaskInput) {
    return this.svc.create(user.companyId, body, userActor(user));
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() body: UpdateTaskInput) {
    return this.svc.update(user.companyId, id, body, userActor(user));
  }

  @Post(':id/status')
  @ApiOperation({ summary: 'Change task status (also exposed via legacy /complete)' })
  updateStatus(@CurrentUser() user: User, @Param('id') id: string, @Body() body: UpdateStatusBody) {
    return this.svc.updateStatus(user.companyId, id, body.status, userActor(user), body.reason);
  }

  // Legacy endpoint kept for backwards compat
  @Post(':id/complete')
  complete(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.updateStatus(user.companyId, id, 'DONE', userActor(user));
  }

  @Post(':id/assign')
  assign(@CurrentUser() user: User, @Param('id') id: string, @Body() body: AssignBody) {
    return this.svc.assign(user.companyId, id, body.userId ?? null, userActor(user));
  }

  @Post(':id/comments')
  addComment(@CurrentUser() user: User, @Param('id') id: string, @Body() body: CommentBody) {
    return this.svc.addComment(user.companyId, id, body, userActor(user));
  }

  @Post(':id/subtasks')
  addSubtask(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: CreateTaskInput,
  ) {
    return this.svc.create(user.companyId, { ...body, parentTaskId: id }, userActor(user));
  }

  @Post(':id/watchers')
  addWatcher(@CurrentUser() user: User, @Param('id') id: string, @Body() body: WatcherBody) {
    return this.svc.addWatcher(user.companyId, id, body.userId, userActor(user));
  }

  @Delete(':id/watchers/:uid')
  removeWatcher(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('uid') uid: string,
  ) {
    return this.svc.removeWatcher(user.companyId, id, uid, userActor(user));
  }

  @Post(':id/reschedule')
  reschedule(@CurrentUser() user: User, @Param('id') id: string, @Body() body: RescheduleBody) {
    return this.svc.reschedule(user.companyId, id, body.dueAt, body.reason, userActor(user));
  }

  @Post(':id/snooze')
  snooze(@CurrentUser() user: User, @Param('id') id: string, @Body() body: SnoozeBody) {
    return this.svc.snooze(user.companyId, id, body.minutes, userActor(user));
  }

  @Post(':id/log-time')
  logTime(@CurrentUser() user: User, @Param('id') id: string, @Body() body: LogTimeBody) {
    return this.svc.logTime(user.companyId, id, body.hours, body.note, userActor(user));
  }

  @Post(':id/reminder-offsets')
  setReminders(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: ReminderOffsetsBody,
  ) {
    return this.svc.setReminderOffsets(user.companyId, id, body.offsets, userActor(user));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.remove(user.companyId, id, userActor(user));
  }

  // ── Bulk ──────────────────────────────────────────────────────────────

  @Post('bulk/status')
  bulkStatus(@CurrentUser() user: User, @Body() body: BulkStatusBody) {
    return this.svc.bulkUpdateStatus(user.companyId, body.ids, body.status, userActor(user));
  }

  @Post('bulk/assign')
  bulkAssign(@CurrentUser() user: User, @Body() body: BulkAssignBody) {
    return this.svc.bulkAssign(user.companyId, body.ids, body.userId ?? null, userActor(user));
  }

  @Post('bulk/snooze')
  bulkSnooze(@CurrentUser() user: User, @Body() body: BulkSnoozeBody) {
    return this.svc.bulkSnooze(user.companyId, body.ids, body.minutes, userActor(user));
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

@ApiTags('task-recurrences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('task-recurrences')
export class TaskRecurrencesController {
  constructor(private readonly svc: TasksService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.svc.listRecurrences(user.companyId);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() body: CreateRecurrenceBody) {
    return this.svc.createRecurrence(user.companyId, body);
  }

  @Post(':id/pause')
  pause(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.pauseRecurrence(user.companyId, id, true);
  }

  @Post(':id/resume')
  resume(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.pauseRecurrence(user.companyId, id, false);
  }

  @Delete(':id')
  delete(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.deleteRecurrence(user.companyId, id);
  }
}
