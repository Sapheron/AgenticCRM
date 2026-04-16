import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus, Res,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ContactsService, CreateContactDto } from './contacts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { User } from '@wacrm/database';
import type { Response } from 'express';

@ApiTags('contacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@RequirePermissions('contacts')
@Controller('contacts')
export class ContactsController {
  constructor(private readonly svc: ContactsService) {}

  @Get()
  @ApiOperation({ summary: 'List contacts with search + tag + lifecycle filter' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'tag', required: false })
  @ApiQuery({ name: 'lifecycle', required: false })
  list(
    @CurrentUser() user: User,
    @Query('search') search?: string,
    @Query('tag') tag?: string,
    @Query('lifecycle') lifecycle?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.svc.list(user.companyId, { search, tag, lifecycle, page, limit });
  }

  @Get('export/csv')
  @ApiOperation({ summary: 'Export contacts as CSV' })
  async exportCsv(@CurrentUser() user: User, @Res() res: Response) {
    const csv = await this.svc.exportCsv(user.companyId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=contacts.csv');
    res.send(csv);
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.get(user.companyId, id);
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Get contact activity timeline' })
  timeline(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.getTimeline(user.companyId, id);
  }

  @Get(':id/notes')
  @ApiOperation({ summary: 'Get contact notes' })
  notes(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.getNotes(user.companyId, id);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() body: CreateContactDto) {
    return this.svc.create(user.companyId, body);
  }

  @Post(':id/notes')
  @ApiOperation({ summary: 'Add a note to contact' })
  addNote(@CurrentUser() user: User, @Param('id') id: string, @Body() body: { content: string }) {
    return this.svc.addNote(user.companyId, id, user.id, body.content);
  }

  @Patch(':id/notes/:noteId')
  @ApiOperation({ summary: 'Edit a contact note' })
  updateNote(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @Body() body: { content: string },
  ) {
    return this.svc.updateNote(user.companyId, id, noteId, user.id, body.content);
  }

  @Delete(':id/notes/:noteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a contact note (soft-delete)' })
  deleteNote(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('noteId') noteId: string,
  ) {
    return this.svc.deleteNote(user.companyId, id, noteId, user.id);
  }

  @Post('bulk/tag')
  @ApiOperation({ summary: 'Bulk add/remove tags' })
  bulkTag(@CurrentUser() user: User, @Body() body: { contactIds: string[]; addTags?: string[]; removeTags?: string[] }) {
    return this.svc.bulkTag(user.companyId, body.contactIds, body.addTags, body.removeTags);
  }

  @Post('bulk/delete')
  @ApiOperation({ summary: 'Bulk soft-delete contacts' })
  bulkDelete(@CurrentUser() user: User, @Body() body: { contactIds: string[] }) {
    return this.svc.bulkDelete(user.companyId, body.contactIds);
  }

  @Post('merge')
  @ApiOperation({ summary: 'Merge two contacts into one' })
  merge(@CurrentUser() user: User, @Body() body: { keepId: string; mergeId: string }) {
    return this.svc.merge(user.companyId, body.keepId, body.mergeId);
  }

  @Post('import/csv')
  @ApiOperation({ summary: 'Import contacts from CSV text' })
  importCsv(@CurrentUser() user: User, @Body() body: { csv: string }) {
    return this.svc.importCsv(user.companyId, body.csv);
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() body: Partial<CreateContactDto>) {
    return this.svc.update(user.companyId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.softDelete(user.companyId, id);
  }

  @Post(':id/opt-out')
  @ApiOperation({ summary: 'GDPR opt-out' })
  optOut(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.optOut(user.companyId, id);
  }
}
