import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SystemService } from './system.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '@wacrm/database';
import { ForbiddenException } from '@nestjs/common';

function requireAdmin(user: User) {
  if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
    throw new ForbiddenException('Only admins can access system settings');
  }
}

@ApiTags('system')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('system')
export class SystemController {
  constructor(private readonly svc: SystemService) {}

  /** Current version info — available to all authenticated users */
  @Get('version')
  version() {
    return this.svc.getVersion();
  }

  /** Check if an update is available — admin only */
  @Get('check-update')
  async checkUpdate(@CurrentUser() user: User) {
    requireAdmin(user);
    return this.svc.checkForUpdate();
  }

  /** Trigger the update process — admin only */
  @Post('update')
  async triggerUpdate(@CurrentUser() user: User) {
    requireAdmin(user);
    return this.svc.triggerUpdate();
  }

  /** Get current update status — admin only */
  @Get('update-status')
  updateStatus(@CurrentUser() user: User) {
    requireAdmin(user);
    return this.svc.getUpdateStatus();
  }

  /** Get changelog (commits between current and latest) — admin only */
  @Get('changelog')
  async changelog(@CurrentUser() user: User) {
    requireAdmin(user);
    return this.svc.getChangelog();
  }
}
