import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { STAFF_ROLES } from '@vip/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { TrackingService } from './tracking.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get('maps/config')
  mapConfig() {
    return this.tracking.mapConfig();
  }

  @Get('tracking/live')
  @Roles(...STAFF_ROLES)
  live(@CurrentUser() user: AuthUser) {
    return this.tracking.live(user);
  }

  @Get('import-jobs/:jobId/tracking')
  @Roles(...STAFF_ROLES)
  forJob(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    return this.tracking.forJob(user, jobId, false);
  }

  @Post('import-jobs/:jobId/tracking/advance')
  @Roles(...STAFF_ROLES)
  advance(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    return this.tracking.advance(user, jobId);
  }

  @Get('portal/jobs/:jobId/tracking')
  @Roles('CUSTOMER')
  forCustomerJob(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    return this.tracking.forJob(user, jobId, true);
  }
}
