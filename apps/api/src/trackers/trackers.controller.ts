import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { STAFF_ROLES } from '@vip/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { TrackersService } from './trackers.service';
import {
  AssignTrackerDto,
  ConfirmRemovalDto,
  CreateLocationDto,
  CreateTrackerDto,
  UnassignTrackerDto,
  UpdateTrackerDto,
} from './dto/tracker.dto';
import { FlespiIngestService } from '../integrations/flespi-ingest.service';

@Controller('trackers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STAFF_ROLES)
export class TrackersController {
  constructor(
    private readonly trackers: TrackersService,
    private readonly flespi: FlespiIngestService,
  ) {}

  @Get()
  @Roles(...STAFF_ROLES)
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

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTrackerDto,
  ) {
    return this.trackers.update(user, id, dto);
  }

  @Post('assignments/:assignmentId/unassign')
  unassign(
    @CurrentUser() user: AuthUser,
    @Param('assignmentId') assignmentId: string,
    @Body() dto: UnassignTrackerDto,
  ) {
    return this.trackers.unassign(user, assignmentId, dto);
  }

  @Post('assignments/:assignmentId/confirm-removal')
  confirmRemoval(
    @CurrentUser() user: AuthUser,
    @Param('assignmentId') assignmentId: string,
    @Body() dto: ConfirmRemovalDto,
  ) {
    return this.trackers.confirmRemoval(user, assignmentId, dto);
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
