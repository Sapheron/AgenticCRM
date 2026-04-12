import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, MinLength } from 'class-validator';
import { TeamService, CreateMemberDto } from './team.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User, UserRole } from '@wacrm/database';

class UpdateRoleBody {
  @IsEnum(['ADMIN', 'MANAGER', 'AGENT'])
  role: UserRole;
}

class UpdateProfileBody {
  @IsString() @IsOptional() firstName?: string;
  @IsString() @IsOptional() lastName?: string;
  @IsString() @IsOptional() avatarUrl?: string;
}

class ChangePasswordBody {
  @IsString() currentPassword: string;
  @IsString() @MinLength(8) newPassword: string;
}

@ApiTags('team')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('team')
export class TeamController {
  constructor(private readonly svc: TeamService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.svc.list(user.companyId);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  me(@CurrentUser() user: User) {
    return this.svc.get(user.companyId, user.id);
  }

  @Patch('me')
  updateProfile(@CurrentUser() user: User, @Body() body: UpdateProfileBody) {
    return this.svc.updateProfile(user.id, body);
  }

  @Post('me/change-password')
  changePassword(@CurrentUser() user: User, @Body() body: ChangePasswordBody) {
    return this.svc.changePassword(user.id, body.currentPassword, body.newPassword);
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.get(user.companyId, id);
  }

  @Post('members')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create a new team member (admin sets the password)' })
  createMember(@CurrentUser() user: User, @Body() body: CreateMemberDto) {
    return this.svc.createMember(user.companyId, body);
  }

  @Patch(':id/role')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  updateRole(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: UpdateRoleBody,
  ) {
    return this.svc.updateRole(user.companyId, id, body.role, user.id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.deactivate(user.companyId, id, user.id);
  }
}
