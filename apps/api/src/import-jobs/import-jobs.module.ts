import { Module } from '@nestjs/common';
import { ImportJobsController } from './import-jobs.controller';
import { ImportJobsService } from './import-jobs.service';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [TrackingModule],
  controllers: [ImportJobsController],
  providers: [ImportJobsService],
  exports: [ImportJobsService],
})
export class ImportJobsModule {}
