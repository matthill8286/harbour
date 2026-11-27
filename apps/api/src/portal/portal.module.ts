import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { TrackingModule } from '../tracking/tracking.module';
import { WorkflowModule } from '../workflow/workflow.module';

@Module({
  imports: [TrackingModule, WorkflowModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
