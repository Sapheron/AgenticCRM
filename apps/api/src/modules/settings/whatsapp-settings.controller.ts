import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';
import { WhatsAppSettingsService } from './whatsapp-settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { User } from '@wacrm/database';

class CreateAccountBody {
  @IsString() @IsOptional()
  phoneNumber?: string;
}

@ApiTags('whatsapp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@RequirePermissions('whatsapp')
@Controller('settings/whatsapp/accounts')
export class WhatsAppSettingsController {
  constructor(private readonly svc: WhatsAppSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'List connected WhatsApp accounts (filtered by user)' })
  list(@CurrentUser() user: User) {
    return this.svc.listAccounts(user.companyId, user);
  }

  @Post()
  @ApiOperation({ summary: 'Add a new WhatsApp account (linked to your user)' })
  create(@CurrentUser() user: User, @Body() body: CreateAccountBody) {
    return this.svc.createAccount(user.companyId, user.id, body.phoneNumber);
  }

  @Post(':id/reconnect')
  @ApiOperation({ summary: 'Reconnect a WhatsApp account (re-triggers QR flow)' })
  reconnect(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.reconnectAccount(user.companyId, id, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a WhatsApp account' })
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.deleteAccount(user.companyId, id, user.id, user.role);
  }
}
