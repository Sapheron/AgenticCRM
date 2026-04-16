import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsArray, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { DealsService } from './deals.service';
import {
  type CreateDealDto as CreateDealInput,
  type UpdateDealDto as UpdateDealInput,
  type ListDealsFilters,
  type CreateLineItemDto,
  type UpdateLineItemDto,
  type DealActor,
} from './deals.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { User, DealStage, DealSource, DealPriority, DealLossReason, DealActivityType } from '@wacrm/database';

const STAGES = ['LEAD_IN', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] as const;
const LOSS_REASONS = ['PRICE', 'COMPETITOR', 'TIMING', 'NO_BUDGET', 'NO_DECISION', 'WRONG_FIT', 'GHOSTED', 'OTHER'] as const;

class MoveStageBody {
  @IsEnum(STAGES) stage: DealStage;
  @IsEnum(LOSS_REASONS) @IsOptional() lossReason?: DealLossReason;
  @IsString() @IsOptional() lossReasonText?: string;
}

class AssignBody {
  @IsString() @IsOptional() userId?: string | null;
}

class NoteBody {
  @IsString() body: string;
}

class ActivityBody {
  @IsString() type: DealActivityType;
  @IsString() title: string;
  @IsString() @IsOptional() body?: string;
}

class ProbabilityBody {
  @IsNumber() probability: number;
  @IsString() reason: string;
}

class ReopenBody {
  @IsString() reason: string;
}

class BulkStageBody {
  @IsArray() @IsString({ each: true }) ids: string[];
  @IsEnum(STAGES) stage: DealStage;
  @IsEnum(LOSS_REASONS) @IsOptional() lossReason?: DealLossReason;
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

function userActor(user: User): DealActor {
  return { type: 'user', userId: user.id };
}

@ApiTags('deals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@RequirePermissions('deals')
@Controller('deals')
export class DealsController {
  constructor(private readonly svc: DealsService) {}

  // ── Reads ──────────────────────────────────────────────────────────────

  @Get()
  list(
    @CurrentUser() user: User,
    @Query('stage') stage?: DealStage,
    @Query('source') source?: DealSource,
    @Query('priority') priority?: DealPriority,
    @Query('assignedAgentId') assignedAgentId?: string,
    @Query('contactId') contactId?: string,
    @Query('leadId') leadId?: string,
    @Query('tag') tag?: string,
    @Query('valueMin') valueMin?: string,
    @Query('valueMax') valueMax?: string,
    @Query('probabilityMin') probabilityMin?: string,
    @Query('probabilityMax') probabilityMax?: string,
    @Query('expectedCloseFrom') expectedCloseFrom?: string,
    @Query('expectedCloseTo') expectedCloseTo?: string,
    @Query('nextActionDue') nextActionDue?: string,
    @Query('search') search?: string,
    @Query('sort') sort?: ListDealsFilters['sort'],
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.list(user.companyId, {
      stage,
      source,
      priority,
      assignedAgentId: assignedAgentId === 'null' ? null : assignedAgentId,
      contactId,
      leadId,
      tag,
      valueMin: valueMin ? Number(valueMin) : undefined,
      valueMax: valueMax ? Number(valueMax) : undefined,
      probabilityMin: probabilityMin ? Number(probabilityMin) : undefined,
      probabilityMax: probabilityMax ? Number(probabilityMax) : undefined,
      expectedCloseFrom,
      expectedCloseTo,
      nextActionDue: nextActionDue === 'true',
      search,
      sort,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('forecast')
  forecast(@CurrentUser() user: User, @Query('days') days?: string) {
    return this.svc.forecast(user.companyId, days ? Number(days) : 30);
  }

  @Get('loss-reasons')
  lossReasons(@CurrentUser() user: User, @Query('days') days?: string) {
    return this.svc.lossReasonAnalytics(user.companyId, days ? Number(days) : 90);
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.get(user.companyId, id);
  }

  @Get(':id/timeline')
  timeline(@CurrentUser() user: User, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.svc.getTimeline(user.companyId, id, limit ? Number(limit) : 100);
  }

  @Get(':id/line-items')
  lineItems(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.getLineItems(user.companyId, id);
  }

  // ── Writes ─────────────────────────────────────────────────────────────

  @Post()
  create(@CurrentUser() user: User, @Body() body: CreateDealInput) {
    return this.svc.create(user.companyId, body, userActor(user));
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() body: UpdateDealInput) {
    return this.svc.update(user.companyId, id, body, userActor(user));
  }

  @Post(':id/stage')
  @ApiOperation({ summary: 'Move deal to a new stage' })
  moveStage(@CurrentUser() user: User, @Param('id') id: string, @Body() body: MoveStageBody) {
    return this.svc.moveStage(user.companyId, id, body, userActor(user));
  }

  // Keep PATCH /:id/stage for backwards compat with the existing kanban
  @Patch(':id/stage')
  moveStagePatch(@CurrentUser() user: User, @Param('id') id: string, @Body() body: MoveStageBody) {
    return this.svc.moveStage(user.companyId, id, body, userActor(user));
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
  @ApiOperation({ summary: 'Edit a deal note (activity of type NOTE)' })
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
  @ApiOperation({ summary: 'Delete a deal note (soft-delete)' })
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

  @Post(':id/probability')
  setProbability(@CurrentUser() user: User, @Param('id') id: string, @Body() body: ProbabilityBody) {
    return this.svc.setProbability(user.companyId, id, body.probability, body.reason, userActor(user));
  }

  @Post(':id/reopen')
  reopen(@CurrentUser() user: User, @Param('id') id: string, @Body() body: ReopenBody) {
    return this.svc.reopen(user.companyId, id, body.reason, userActor(user));
  }

  @Post(':id/line-items')
  addLineItem(@CurrentUser() user: User, @Param('id') id: string, @Body() body: CreateLineItemDto) {
    return this.svc.addLineItem(user.companyId, id, body, userActor(user));
  }

  @Patch(':id/line-items/:itemId')
  updateLineItem(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: UpdateLineItemDto,
  ) {
    return this.svc.updateLineItem(user.companyId, id, itemId, body, userActor(user));
  }

  @Delete(':id/line-items/:itemId')
  removeLineItem(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.svc.removeLineItem(user.companyId, id, itemId, userActor(user));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.remove(user.companyId, id, userActor(user));
  }

  // ── Bulk ──────────────────────────────────────────────────────────────

  @Post('bulk/stage')
  bulkStage(@CurrentUser() user: User, @Body() body: BulkStageBody) {
    return this.svc.bulkMoveStage(user.companyId, body.ids, body.stage, userActor(user), body.lossReason);
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
