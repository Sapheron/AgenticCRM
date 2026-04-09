import { Controller, Get, Put, Post, Body, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsEnum, IsString, IsOptional, IsBoolean, IsNumber, Min, Max } from 'class-validator';
import { AiSettingsService, UpsertAiConfigDto } from './ai-settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User, AiProvider } from '@wacrm/database';

class UpsertAiConfigBody implements UpsertAiConfigDto {
  @IsEnum(['GEMINI','OPENAI','ANTHROPIC','GROQ','DEEPSEEK','XAI','MISTRAL','TOGETHER','MOONSHOT','GLM','QWEN','STEPFUN','OLLAMA','OPENROUTER','CUSTOM'])
  provider: AiProvider;

  @IsString()
  model: string;

  @IsString() @IsOptional()
  apiKey?: string;

  @IsString() @IsOptional()
  baseUrl?: string;

  @IsString() @IsOptional()
  systemPrompt?: string;

  @IsString() @IsOptional()
  tone?: string;

  @IsNumber() @IsOptional() @Min(64) @Max(8192)
  maxTokens?: number;

  @IsNumber() @IsOptional() @Min(0) @Max(2)
  temperature?: number;

  @IsBoolean() @IsOptional()
  autoReplyEnabled?: boolean;

  @IsBoolean() @IsOptional()
  toolCallingEnabled?: boolean;
}

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('settings/ai')
export class AiSettingsController {
  constructor(private readonly svc: AiSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get AI configuration' })
  get(@CurrentUser() user: User) {
    return this.svc.get(user.companyId);
  }

  @Put()
  @ApiOperation({ summary: 'Save AI configuration from dashboard' })
  upsert(@CurrentUser() user: User, @Body() body: UpsertAiConfigBody) {
    return this.svc.upsert(user.companyId, body);
  }

  @Post('test')
  @ApiOperation({ summary: 'Test AI provider connection' })
  test(@CurrentUser() user: User) {
    return this.svc.test(user.companyId);
  }

  @Get('models')
  @ApiOperation({ summary: 'Get available models for a provider' })
  models(@Query('provider') provider: AiProvider) {
    return this.svc.getProviderModels(provider);
  }
}
