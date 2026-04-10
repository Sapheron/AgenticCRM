import { Module } from '@nestjs/common';
import { TasksController, TaskRecurrencesController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  controllers: [TasksController, TaskRecurrencesController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
