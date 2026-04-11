/**
 * Campaigns REST API.
 *
 * Every mutation resolves a `CampaignActor` from the JWT user so the service
 * can attribute the resulting CampaignActivity row.
 */
import {
  BadRequestException,
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
  CampaignChannel,
  CampaignRecipientStatus,
  CampaignSendMode,
  CampaignStatus,
  User,
} from '@wacrm/database';
import { CampaignsService } from './campaigns.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type {
  CampaignActor,
  CampaignAudienceFilter,
  CreateCampaignDto,
  UpdateCampaignDto,
} from './campaigns.types';

function userActor(user: User): CampaignActor {
  return { type: 'user', userId: user.id };
}

@ApiTags('campaigns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly svc: CampaignsService) {}

  @Get()
  list(
    @CurrentUser() user: User,
    @Query('status') status?: string,
    @Query('channel') channel?: string,
    @Query('sendMode') sendMode?: string,
    @Query('priority') priority?: string,
    @Query('tag') tag?: string,
    @Query('search') search?: string,
    @Query('sort') sort?: 'recent' | 'scheduled' | 'name' | 'progress',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.list(user.companyId, {
      status: status ? (status.split(',') as CampaignStatus[]) : undefined,
      channel: channel ? (channel.split(',') as CampaignChannel[]) : undefined,
      sendMode: sendMode ? (sendMode.split(',') as CampaignSendMode[]) : undefined,
      priority: priority ? priority.split(',') : undefined,
      tag,
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
  timeline(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.getTimeline(
      user.companyId,
      id,
      limit ? Number(limit) : undefined,
    );
  }

  @Get(':id/recipients')
  recipients(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listRecipients(user.companyId, id, {
      status: status ? (status.split(',') as CampaignRecipientStatus[]) : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post()
  create(@CurrentUser() user: User, @Body() body: CreateCampaignDto) {
    return this.svc.create(user.companyId, userActor(user), body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: UpdateCampaignDto,
  ) {
    return this.svc.update(user.companyId, id, userActor(user), body);
  }

  @Post(':id/audience')
  setAudience(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: CampaignAudienceFilter,
  ) {
    return this.svc.setAudience(user.companyId, id, userActor(user), body);
  }

  @Post(':id/audience/preview')
  previewAudience(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.previewAudience(user.companyId, id);
  }

  @Post(':id/schedule')
  schedule(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { startAt: string },
  ) {
    if (!body?.startAt) throw new BadRequestException('startAt required');
    return this.svc.schedule(user.companyId, id, userActor(user), body.startAt);
  }

  @Post(':id/launch')
  launch(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.launch(user.companyId, id, userActor(user));
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
  cancel(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { reason?: string } = {},
  ) {
    return this.svc.cancel(user.companyId, id, userActor(user), body.reason);
  }

  @Post(':id/notes')
  addNote(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { body: string },
  ) {
    return this.svc.addNote(user.companyId, id, userActor(user), body.body);
  }

  @Post(':id/duplicate')
  duplicate(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.duplicate(user.companyId, id, userActor(user));
  }

  @Delete(':id')
  async remove(@CurrentUser() user: User, @Param('id') id: string) {
    await this.svc.remove(user.companyId, id);
    return { ok: true };
  }

  @Post('bulk/pause')
  bulkPause(@CurrentUser() user: User, @Body() body: { ids: string[] }) {
    return this.svc.bulkPause(user.companyId, body.ids ?? [], userActor(user));
  }

  @Post('bulk/resume')
  bulkResume(@CurrentUser() user: User, @Body() body: { ids: string[] }) {
    return this.svc.bulkResume(user.companyId, body.ids ?? [], userActor(user));
  }

  @Post('bulk/cancel')
  bulkCancel(
    @CurrentUser() user: User,
    @Body() body: { ids: string[]; reason?: string },
  ) {
    return this.svc.bulkCancel(
      user.companyId,
      body.ids ?? [],
      userActor(user),
      body.reason,
    );
  }

  @Post('bulk/delete')
  bulkDelete(@CurrentUser() user: User, @Body() body: { ids: string[] }) {
    return this.svc.bulkDelete(user.companyId, body.ids ?? []);
  }
}
