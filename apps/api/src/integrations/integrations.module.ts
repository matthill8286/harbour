import { Global, Module } from '@nestjs/common';
import { AnprService } from './anpr.service';
import { GpsProviderService } from './gps-provider.service';
import { MapsService } from './maps.service';
import { AiTransport } from './ai-transport';
import { EmailTransport } from './email-transport';
import { NotificationsService } from './notifications.service';
import { StorageService } from './storage.service';
import { FileDeliveryService } from './file-delivery.service';
import { VehicleDataService } from './vehicle-data.service';
import { FlespiGpsClient } from './flespi-gps.client';
import { FlespiIngestService } from './flespi-ingest.service';
import { FlespiGpsController } from './flespi-gps.controller';
import { FlespiWebhookGuard } from './flespi-webhook.guard';

@Global()
@Module({
  providers: [
    StorageService,
    FileDeliveryService,
    VehicleDataService,
    AnprService,
    MapsService,
    GpsProviderService,
    EmailTransport,
    AiTransport,
    NotificationsService,
    FlespiGpsClient,
    FlespiIngestService,
    FlespiWebhookGuard,
  ],
  controllers: [FlespiGpsController],
  exports: [
    StorageService,
    FileDeliveryService,
    VehicleDataService,
    AnprService,
    MapsService,
    GpsProviderService,
    EmailTransport,
    AiTransport,
    NotificationsService,
    FlespiIngestService,
  ],
})
export class IntegrationsModule {}
