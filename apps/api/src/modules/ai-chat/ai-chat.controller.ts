import { Controller, Post, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsArray, ValidateNested, IsString, IsEnum, IsOptional, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { AiChatService } from './ai-chat.service';
import { ChatConversationsService } from '../chat-conversations/chat-conversations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '@wacrm/database';
import { normalizeAttachments, type ChatAttachment } from './attachments';

class RawAttachmentDto {
  @IsString() mimeType: string;
  @IsString() fileName: string;
  @IsString() dataBase64: string;
  @IsNumber() @IsOptional() size?: number;
}

class ChatMessageDto {
  @IsEnum(['system', 'user', 'assistant'])
  role: 'system' | 'user' | 'assistant';

  @IsString()
  content: string;

  @IsArray() @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => RawAttachmentDto)
  attachments?: RawAttachmentDto[];
}

class AiChatBody {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages: ChatMessageDto[];

  @IsString() @IsOptional()
  conversationId?: string;
}

@ApiTags('ai-chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('ai/chat')
export class AiChatController {
  constructor(
    private readonly svc: AiChatService,
    private readonly convSvc: ChatConversationsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Chat with configured AI model (admin tool)' })
  async chat(@CurrentUser() user: User, @Body() body: AiChatBody) {
    // Validate + normalize attachments per message before any persistence or
    // provider call. Surfaces clean 400s for oversize / unsupported files.
    let normalized: Array<{ role: string; content: string; attachments?: ChatAttachment[] }>;
    try {
      normalized = body.messages.map((m) => ({
        role: m.role,
        content: m.content,
        attachments: m.attachments?.length ? normalizeAttachments(m.attachments) : undefined,
      }));
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Invalid attachment');
    }

    // Save user message (with attachments) to conversation if conversationId provided
    if (body.conversationId) {
      const lastMsg = normalized[normalized.length - 1];
      if (lastMsg?.role === 'user') {
        await this.convSvc.addMessage(body.conversationId, {
          role: 'user',
          content: lastMsg.content,
          attachments: lastMsg.attachments,
        });
      }
    }

    const result = await this.svc.chat(user.companyId, normalized, body.conversationId);

    // Save assistant response to conversation
    if (body.conversationId) {
      await this.convSvc.addMessage(body.conversationId, {
        role: 'assistant',
        content: result.content,
        toolCalls: result.actions?.length ? result.actions : undefined,
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
      });
    }

    return result;
  }
}
