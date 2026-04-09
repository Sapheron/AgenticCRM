import { Module } from '@nestjs/common';
import { AiChatController } from './ai-chat.controller';
import { AiChatService } from './ai-chat.service';

@Module({
  controllers: [AiChatController],
  providers: [AiChatService],
})
export class AiChatModule {}
