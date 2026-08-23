import { Global, Module } from '@nestjs/common';
import { AnprService } from './anpr.service';
import { GpsProviderService } from './gps-provider.service';
import { MapsService } from './maps.service';
import { NotificationsService } from './notifications.service';
import { StorageService } from './storage.service';
import { VehicleDataService } from './vehicle-data.service';
import { FlespiGpsClient } from './flespi-gps.client';
import { FlespiIngestService } from './flespi-ingest.service';
import { FlespiGpsController } from './flespi-gps.controller';
import { FlespiWebhookGuard } from './flespi-webhook.guard';

@Global()
@Module({
  providers: [
    StorageService,
    VehicleDataService,
    AnprService,
    MapsService,
    GpsProviderService,
    NotificationsService,
    FlespiGpsClient,
    FlespiIngestService,
    FlespiWebhookGuard,
  ],
  controllers: [FlespiGpsController],
  exports: [
    StorageService,
    VehicleDataService,
    AnprService,
    MapsService,
    GpsProviderService,
    NotificationsService,
    FlespiIngestService,
  ],
})
export class IntegrationsModule {}
