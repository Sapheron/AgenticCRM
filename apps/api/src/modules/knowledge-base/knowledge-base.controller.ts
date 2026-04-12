/**
 * Knowledge Base REST API — JWT + company scope guarded.
 * Public reader lives in `public-kb.controller.ts`.
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
import type { KBArticleStatus, User } from '@wacrm/database';
import { KnowledgeBaseService } from './knowledge-base.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type {
  CreateKBArticleDto,
  KBArticleActor,
  UpdateKBArticleDto,
} from './knowledge-base.types';

function userActor(user: User): KBArticleActor {
  return { type: 'user', userId: user.id };
}

@ApiTags('knowledge-base')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('kb')
export class KnowledgeBaseController {
  constructor(private readonly svc: KnowledgeBaseService) {}

  @Get()
  list(
    @CurrentUser() user: User,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('isPublic') isPublic?: string,
    @Query('tag') tag?: string,
    @Query('search') search?: string,
    @Query('sort') sort?: 'recent' | 'views' | 'title',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.list(user.companyId, {
      status: status ? (status.split(',') as KBArticleStatus[]) : undefined,
      category,
      isPublic: isPublic === 'true' ? true : isPublic === 'false' ? false : undefined,
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

  @Get('search')
  search(
    @CurrentUser() user: User,
    @Query('q') query?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.search(user.companyId, query ?? '', limit ? Number(limit) : 10);
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

  @Post()
  create(@CurrentUser() user: User, @Body() body: CreateKBArticleDto) {
    return this.svc.create(user.companyId, userActor(user), body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: UpdateKBArticleDto,
  ) {
    return this.svc.update(user.companyId, id, userActor(user), body);
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

  @Delete(':id')
  async remove(@CurrentUser() user: User, @Param('id') id: string) {
    await this.svc.remove(user.companyId, id);
    return { ok: true };
  }

  @Post('bulk/publish')
  bulkPublish(@CurrentUser() user: User, @Body() body: { ids: string[] }) {
    return this.svc.bulkPublish(user.companyId, body.ids ?? [], userActor(user));
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
