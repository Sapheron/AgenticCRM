/**
 * Forms REST API — admin endpoints (JWT + company scope guarded).
 *
 * Public submission endpoints live in `public-form.controller.ts`, and the
 * API-key-protected webhook lives in `forms-webhook.controller.ts`.
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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import type {
  FormStatus,
  FormSubmissionStatus,
  User,
} from '@wacrm/database';
import { FormsService } from './forms.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type {
  AutoActionsConfig,
  CreateFormDto,
  FormActor,
  FormField,
  SubmissionMeta,
  UpdateFormDto,
} from './forms.types';

function userActor(user: User): FormActor {
  return { type: 'user', userId: user.id };
}

@ApiTags('forms')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('forms')
export class FormsController {
  constructor(private readonly svc: FormsService) {}

  @Get()
  list(
    @CurrentUser() user: User,
    @Query('status') status?: string,
    @Query('tag') tag?: string,
    @Query('search') search?: string,
    @Query('sort') sort?: 'recent' | 'name' | 'submissions' | 'conversion',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.list(user.companyId, {
      status: status ? (status.split(',') as FormStatus[]) : undefined,
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

  @Get(':id/submissions')
  listSubmissions(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listSubmissions(user.companyId, id, {
      status: status ? (status.split(',') as FormSubmissionStatus[]) : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id/submissions/:sid')
  getSubmission(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('sid') sid: string,
  ) {
    return this.svc.getSubmission(user.companyId, id, sid);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() body: CreateFormDto) {
    return this.svc.create(user.companyId, userActor(user), body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: UpdateFormDto,
  ) {
    return this.svc.update(user.companyId, id, userActor(user), body);
  }

  @Post(':id/fields')
  addField(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: FormField,
  ) {
    return this.svc.addField(user.companyId, id, userActor(user), body);
  }

  @Delete(':id/fields/:key')
  removeField(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('key') key: string,
  ) {
    return this.svc.removeField(user.companyId, id, userActor(user), key);
  }

  @Post(':id/fields/reorder')
  reorderFields(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { keys: string[] },
  ) {
    if (!Array.isArray(body.keys)) throw new BadRequestException('keys required');
    return this.svc.reorderFields(user.companyId, id, userActor(user), body.keys);
  }

  @Post(':id/auto-actions')
  setAutoActions(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: AutoActionsConfig,
  ) {
    return this.svc.setAutoActions(user.companyId, id, userActor(user), body);
  }

  @Post(':id/publish')
  publish(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.publish(user.companyId, id, userActor(user));
  }

  @Post(':id/unpublish')
  unpublish(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.unpublish(user.companyId, id, userActor(user));
  }

  @Post(':id/archive')
  archive(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.archive(user.companyId, id, userActor(user));
  }

  @Post(':id/restore')
  restore(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.restore(user.companyId, id, userActor(user));
  }

  @Post(':id/duplicate')
  duplicate(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.duplicate(user.companyId, id, userActor(user));
  }

  @Post(':id/notes')
  addNote(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { body: string },
  ) {
    return this.svc.addNote(user.companyId, id, userActor(user), body.body);
  }

  @Post(':id/rotate-webhook-secret')
  rotateWebhookSecret(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.rotateWebhookSecret(user.companyId, id, userActor(user));
  }

  @Delete(':id')
  async remove(@CurrentUser() user: User, @Param('id') id: string) {
    await this.svc.remove(user.companyId, id);
    return { ok: true };
  }

  /**
   * Manual submission from the dashboard. Reuses `submit()` so activity
   * logging + auto-actions still fire, but flagged as user-actor so we
   * know a human pushed it in.
   */
  @Post(':id/submissions')
  async createSubmission(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { data: Record<string, unknown> },
    @Req() req: Request,
  ) {
    const meta: SubmissionMeta = {
      actor: userActor(user),
      ipAddress:
        (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
        req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    };
    return this.svc.submit(user.companyId, id, body.data ?? {}, meta);
  }

  @Post(':id/submissions/:sid/convert')
  convertSubmission(
    @CurrentUser() user: User,
    @Param('id') _id: string,
    @Param('sid') sid: string,
    @Body() body: { title?: string; source?: string; tags?: string[] } = {},
  ) {
    return this.svc.convertSubmissionToLead(
      user.companyId,
      sid,
      userActor(user),
      body as never,
    );
  }

  @Post(':id/submissions/:sid/mark-spam')
  markSpam(
    @CurrentUser() user: User,
    @Param('id') _id: string,
    @Param('sid') sid: string,
  ) {
    return this.svc.markSubmissionSpam(user.companyId, sid, userActor(user));
  }

  @Delete(':id/submissions/:sid')
  async deleteSubmission(
    @CurrentUser() user: User,
    @Param('id') _id: string,
    @Param('sid') sid: string,
  ) {
    await this.svc.deleteSubmission(user.companyId, sid);
    return { ok: true };
  }

  @Post('bulk/publish')
  bulkPublish(@CurrentUser() user: User, @Body() body: { ids: string[] }) {
    return this.svc.bulkPublish(user.companyId, body.ids ?? [], userActor(user));
  }

  @Post('bulk/unpublish')
  bulkUnpublish(@CurrentUser() user: User, @Body() body: { ids: string[] }) {
    return this.svc.bulkUnpublish(user.companyId, body.ids ?? [], userActor(user));
  }

  @Post('bulk/archive')
  bulkArchive(@CurrentUser() user: User, @Body() body: { ids: string[] }) {
    return this.svc.bulkArchive(user.companyId, body.ids ?? [], userActor(user));
  }

  @Post('bulk/delete')
  bulkDelete(@CurrentUser() user: User, @Body() body: { ids: string[] }) {
    return this.svc.bulkDelete(user.companyId, body.ids ?? []);
  }
}
