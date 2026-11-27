import { Module } from '@nestjs/common';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { GpsIndexesService } from './gps-indexes.service';

@Module({
  controllers: [TrackingController],
  providers: [TrackingService, GpsIndexesService],
  exports: [TrackingService],
})
export class TrackingModule {}
