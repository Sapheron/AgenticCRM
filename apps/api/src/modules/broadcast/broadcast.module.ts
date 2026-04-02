import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES } from '@wacrm/shared';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.BROADCAST })],
  controllers: [BroadcastController],
  providers: [BroadcastService],
})
export class BroadcastModule {}
