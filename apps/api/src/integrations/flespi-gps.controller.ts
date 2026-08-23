import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { FlespiIngestService } from './flespi-ingest.service';
import { FlespiWebhookGuard } from './flespi-webhook.guard';

@Controller('integrations/gps/flespi')
@UseGuards(FlespiWebhookGuard)
export class FlespiGpsController {
  constructor(private readonly ingest: FlespiIngestService) {}

  @Post()
  @HttpCode(200)
  ingest(@Body() body: unknown) {
    return this.ingest.ingestBody(body);
  }
}
