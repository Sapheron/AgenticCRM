import { Module } from '@nestjs/common';
import { AiChatController } from './ai-chat.controller';
import { AiChatService } from './ai-chat.service';
import { AiMemoryModule } from '../ai-memory/ai-memory.module';
import { MemoryModule } from '../memory/memory.module';
import { ChatConversationsModule } from '../chat-conversations/chat-conversations.module';

@Module({
  imports: [AiMemoryModule, MemoryModule, ChatConversationsModule],
  controllers: [AiChatController],
  providers: [AiChatService],
})
export class AiChatModule {}
