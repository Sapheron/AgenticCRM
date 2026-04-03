import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { prisma } from '@wacrm/database';
import { NotFoundException } from '@nestjs/common';
import type { User } from '@wacrm/database';
import Redis from 'ioredis';

class SendMessageBody {
  @IsString() conversationId: string;
  @IsString() text: string;
  @IsString() @IsOptional() replyToMessageId?: string;
}

@ApiTags('messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@Controller('messages')
export class MessagesController {
  private readonly redis = new Redis(process.env.REDIS_URL!);

  constructor(private readonly svc: MessagesService) {}

  @Post('send')
  @ApiOperation({ summary: 'Send an outbound message from the agent (manual reply)' })
  async send(@CurrentUser() user: User, @Body() body: SendMessageBody) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: body.conversationId, companyId: user.companyId },
      include: {
        contact: { select: { phoneNumber: true } },
        whatsappAccount: { select: { id: true } },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    // Store message in DB + emit WS
    const message = await this.svc.store({
      companyId: user.companyId,
      conversationId: body.conversationId,
      whatsappAccountId: conversation.whatsappAccountId,
      direction: 'OUTBOUND',
      type: 'TEXT',
      body: body.text,
      replyToMessageId: body.replyToMessageId,
      isAiGenerated: false,
    });

    // Signal WhatsApp service to send
    await this.redis.publish('wa:outbound', JSON.stringify({
      accountId: conversation.whatsappAccountId,
      contactId: conversation.contactId,
      toPhone: conversation.contact.phoneNumber,
      messageId: message.id,
      text: body.text,
    }));

    return message;
  }
}
