import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FlespiIngestService } from './flespi-ingest.service';
import { FlespiWebhookGuard } from './flespi-webhook.guard';
import {
  WorkspaceGpsWebhookGuard,
  type WorkspaceGpsRequest,
} from './workspace-gps-webhook.guard';

@Controller('integrations/gps/flespi')
export class FlespiGpsController {
  constructor(private readonly flespi: FlespiIngestService) {}

  /** The platform's own Flespi account, which may deliver to any workspace. */
  @Post()
  @HttpCode(200)
  @UseGuards(FlespiWebhookGuard)
  ingest(@Body() body: unknown) {
    return this.flespi.ingestBody(body);
  }

  /** A workspace's own Flespi account, which delivers only to that workspace. */
  @Post('workspaces/:slug')
  @HttpCode(200)
  @UseGuards(WorkspaceGpsWebhookGuard)
  ingestForWorkspace(
    @Req() request: WorkspaceGpsRequest,
    @Body() body: unknown,
  ) {
    return this.flespi.ingestBody(body, request.gpsOrganisationId);
  }
}
