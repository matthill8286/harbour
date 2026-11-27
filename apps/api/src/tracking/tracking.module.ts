import { Module } from '@nestjs/common';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { GpsIndexesService } from './gps-indexes.service';
import { GpsRetentionService } from './gps-retention.service';

@Module({
  controllers: [TrackingController],
  providers: [TrackingService, GpsIndexesService, GpsRetentionService],
  exports: [TrackingService],
})
export class TrackingModule {}
