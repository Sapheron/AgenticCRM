import { Controller, Get, Post, Patch, Delete, Body, Param,  UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FormsService } from './forms.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '@wacrm/database';

@ApiTags('forms')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('forms')
export class FormsController {
  constructor(private readonly svc: FormsService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.svc.list(user.companyId, {});
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.get(user.companyId, id);
  }

  @Get(':id/submissions')
  listSubmissions(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.listSubmissions(user.companyId, id);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() body: { name: string; fields?: any; isActive?: boolean }) {
    return this.svc.create(user.companyId, body);
  }

  @Post(':id/submissions')
  createSubmission(@CurrentUser() user: User, @Param('id') id: string, @Body() body: { data: any; contactId?: string; leadId?: string; utmSource?: string; utmMedium?: string; utmCampaign?: string; ipAddress?: string }) {
    return this.svc.createSubmission(user.companyId, id, body);
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() body: { name?: string; fields?: any; isActive?: boolean }) {
    return this.svc.update(user.companyId, id, body);
  }

  @Delete(':id')
  delete(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.delete(user.companyId, id);
  }
}
