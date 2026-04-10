import { Module } from '@nestjs/common';
import { ChatConversationsController } from './chat-conversations.controller';
import { ChatConversationsService } from './chat-conversations.service';
import { MemoryModule } from '../memory/memory.module';

@Module({
  imports: [MemoryModule],
  controllers: [ChatConversationsController],
  providers: [ChatConversationsService],
  exports: [ChatConversationsService],
})
export class ChatConversationsModule {}
