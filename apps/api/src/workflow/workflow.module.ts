import { Module } from '@nestjs/common';
import { WorkflowRoutesController } from './workflow-routes.controller';
import { WorkflowRoutesService } from './workflow-routes.service';

@Module({
  controllers: [WorkflowRoutesController],
  providers: [WorkflowRoutesService],
  exports: [WorkflowRoutesService],
})
export class WorkflowModule {}
