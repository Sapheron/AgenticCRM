import { Module } from '@nestjs/common';
import { AiChatController } from './ai-chat.controller';
import { AiChatService } from './ai-chat.service';
import { StaffWaBridgeService } from './staff-wa-bridge.service';
import { AiMemoryModule } from '../ai-memory/ai-memory.module';
import { MemoryModule } from '../memory/memory.module';
import { ChatConversationsModule } from '../chat-conversations/chat-conversations.module';
import { AiSettingsService } from '../settings/ai-settings.service';

@Module({
  imports: [AiMemoryModule, MemoryModule, ChatConversationsModule],
  controllers: [AiChatController],
  providers: [AiChatService, StaffWaBridgeService, AiSettingsService],
  exports: [AiChatService],
})
export class AiChatModule {}
