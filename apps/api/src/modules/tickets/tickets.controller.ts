/**
 * Tickets REST API — JWT + company scope guarded.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type {
  TicketPriority,
  TicketSource,
  TicketStatus,
  User,
} from '@wacrm/database';
import { TicketsService } from './tickets.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type {
  CreateTicketDto,
  TicketActor,
  UpdateTicketDto,
} from './tickets.types';

function userActor(user: User): TicketActor {
  return { type: 'user', userId: user.id };
}

@ApiTags('tickets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('tickets')
export class TicketsController {
  constructor(private readonly svc: TicketsService) {}

  @Get()
  list(
    @CurrentUser() user: User,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('source') source?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('contactId') contactId?: string,
    @Query('category') category?: string,
    @Query('tag') tag?: string,
    @Query('search') search?: string,
    @Query('slaBreached') slaBreached?: string,
    @Query('sort') sort?: 'recent' | 'priority' | 'updated' | 'oldest',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.list(user.companyId, {
      status: status ? (status.split(',') as TicketStatus[]) : undefined,
      priority: priority ? (priority.split(',') as TicketPriority[]) : undefined,
      source: source ? (source.split(',') as TicketSource[]) : undefined,
      assignedToId: assignedToId === 'null' ? null : assignedToId,
      contactId,
      category,
      tag,
      search,
      slaBreached: slaBreached === 'true' ? true : undefined,
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
  timeline(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.getTimeline(user.companyId, id, limit ? Number(limit) : undefined);
  }

  @Get(':id/comments')
  listComments(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.listComments(user.companyId, id);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() body: CreateTicketDto) {
    return this.svc.create(user.companyId, userActor(user), body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: UpdateTicketDto,
  ) {
    return this.svc.update(user.companyId, id, userActor(user), body);
  }

  @Post(':id/status')
  changeStatus(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { status: TicketStatus; reason?: string },
  ) {
    return this.svc.changeStatus(user.companyId, id, userActor(user), body.status, body.reason);
  }

  @Post(':id/assign')
  assign(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { assignedToId: string | null },
  ) {
    return this.svc.assign(user.companyId, id, userActor(user), body.assignedToId);
  }

  @Post(':id/escalate')
  escalate(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { reason?: string } = {},
  ) {
    return this.svc.escalate(user.companyId, id, userActor(user), body.reason);
  }

  @Post(':id/comments')
  addComment(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { content: string; isInternal?: boolean },
  ) {
    return this.svc.addComment(
      user.companyId,
      id,
      userActor(user),
      body.content,
      body.isInternal,
    );
  }

  @Post(':id/merge')
  merge(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { targetTicketId: string },
  ) {
    return this.svc.merge(user.companyId, id, body.targetTicketId, userActor(user));
  }

  @Post(':id/notes')
  addNote(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { body: string },
  ) {
    return this.svc.addNote(user.companyId, id, userActor(user), body.body);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: User, @Param('id') id: string) {
    await this.svc.remove(user.companyId, id);
    return { ok: true };
  }

  @Post('bulk/assign')
  bulkAssign(
    @CurrentUser() user: User,
    @Body() body: { ids: string[]; assignedToId: string },
  ) {
    return this.svc.bulkAssign(user.companyId, body.ids ?? [], userActor(user), body.assignedToId);
  }

  @Post('bulk/close')
  bulkClose(@CurrentUser() user: User, @Body() body: { ids: string[] }) {
    return this.svc.bulkClose(user.companyId, body.ids ?? [], userActor(user));
  }

  @Post('bulk/delete')
  bulkDelete(@CurrentUser() user: User, @Body() body: { ids: string[] }) {
    return this.svc.bulkDelete(user.companyId, body.ids ?? []);
  }
}
