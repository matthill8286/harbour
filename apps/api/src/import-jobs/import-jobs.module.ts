import { Module } from '@nestjs/common';
import { ImportJobsController } from './import-jobs.controller';
import { ImportJobsService } from './import-jobs.service';
import { JobFilesController } from './job-files.controller';
import { JobFilesService } from './job-files.service';
import { TrackingModule } from '../tracking/tracking.module';
import { RouteTemplatesModule } from '../routes/route-templates.module';
import { WorkflowModule } from '../workflow/workflow.module';

@Module({
  imports: [TrackingModule, RouteTemplatesModule, WorkflowModule],
  controllers: [ImportJobsController, JobFilesController],
  providers: [ImportJobsService, JobFilesService],
  exports: [ImportJobsService],
})
export class ImportJobsModule {}
