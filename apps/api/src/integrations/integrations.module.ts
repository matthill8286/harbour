import { Global, Module } from '@nestjs/common';
import { AnprService } from './anpr.service';
import { GpsProviderService } from './gps-provider.service';
import { MapsService } from './maps.service';
import { NotificationsService } from './notifications.service';
import { StorageService } from './storage.service';
import { VehicleDataService } from './vehicle-data.service';

@Global()
@Module({
  providers: [
    StorageService,
    VehicleDataService,
    AnprService,
    MapsService,
    GpsProviderService,
    NotificationsService,
  ],
  exports: [
    StorageService,
    VehicleDataService,
    AnprService,
    MapsService,
    GpsProviderService,
    NotificationsService,
  ],
})
export class IntegrationsModule {}
