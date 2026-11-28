import { Module } from '@nestjs/common';
import { TrackersController } from './trackers.controller';
import { TrackersService } from './trackers.service';
import { GpsSettingsController } from './gps-settings.controller';
import { GpsSettingsService } from './gps-settings.service';

@Module({
  controllers: [TrackersController, GpsSettingsController],
  providers: [TrackersService, GpsSettingsService],
})
export class TrackersModule {}
