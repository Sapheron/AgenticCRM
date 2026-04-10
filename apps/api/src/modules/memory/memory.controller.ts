/**
 * Memory REST API — drives the dashboard's file-browser memory page.
 */
import { Controller, Get, Post, Delete, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber } from 'class-validator';
import { MemoryService } from './memory.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '@wacrm/database';

class WriteFileDto {
  @IsString() path: string;
  @IsString() content: string;
  @IsString() @IsOptional() source?: string;
}

class SearchDto {
  @IsString() query: string;
  @IsNumber() @IsOptional() maxResults?: number;
  @IsNumber() @IsOptional() minScore?: number;
  @IsString() @IsOptional() source?: string;
}

@ApiTags('memory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('memory')
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  @Get('files')
  listFiles(@CurrentUser() user: User, @Query('source') source?: string) {
    return this.memory.listFiles(user.companyId, source);
  }

  @Get('file')
  async readFile(@CurrentUser() user: User, @Query('path') path: string) {
    const content = await this.memory.readFile(user.companyId, path);
    if (content === null) return { path, content: null };
    return { path, content };
  }

  @Post('file')
  writeFile(@CurrentUser() user: User, @Body() body: WriteFileDto) {
    return this.memory.writeFile(user.companyId, body.path, body.content, body.source);
  }

  @Delete('file')
  async deleteFile(@CurrentUser() user: User, @Query('path') path: string) {
    await this.memory.deleteFile(user.companyId, path);
    return { ok: true };
  }

  @Post('search')
  search(@CurrentUser() user: User, @Body() body: SearchDto) {
    return this.memory.search(user.companyId, body.query, {
      maxResults: body.maxResults,
      minScore: body.minScore,
      source: body.source,
    });
  }

  @Get('stats')
  stats(@CurrentUser() user: User) {
    return this.memory.stats(user.companyId);
  }
}
