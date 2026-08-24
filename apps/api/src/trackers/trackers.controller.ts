import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { TrackersService } from './trackers.service';
import { AssignTrackerDto, CreateLocationDto, CreateTrackerDto } from './dto/tracker.dto';
import { FlespiIngestService } from '../integrations/flespi-ingest.service';

@Controller('trackers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
export class TrackersController {
  constructor(
    private readonly trackers: TrackersService,
    private readonly flespi: FlespiIngestService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.trackers.list(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTrackerDto) {
    return this.trackers.create(user, dto);
  }

  @Post('jobs/:jobId/assign')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @Body() dto: AssignTrackerDto,
  ) {
    return this.trackers.assign(user, jobId, dto);
  }

  @Post('assignments/:assignmentId/unassign')
  unassign(@CurrentUser() user: AuthUser, @Param('assignmentId') assignmentId: string) {
    return this.trackers.unassign(user, assignmentId);
  }

  @Post(':id/sync')
  sync(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.flespi.syncTracker(user.organisationId, id);
  }

  @Post(':id/locations')
  addLocation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateLocationDto,
  ) {
    return this.trackers.addLocation(user, id, dto);
  }
}
