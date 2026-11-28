import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsInt, Max, Min, ValidateIf } from 'class-validator';
import {
  MAX_GPS_RETENTION_DAYS,
  MIN_GPS_RETENTION_DAYS,
  STAFF_ROLES,
} from '@vip/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { GpsSettingsService } from './gps-settings.service';

export class UpdateGpsSettingsDto {
  /** Null goes back to the platform's period. */
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(MIN_GPS_RETENTION_DAYS)
  @Max(MAX_GPS_RETENTION_DAYS)
  retentionDays!: number | null;
}

@Controller('organisation/gps')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GpsSettingsController {
  constructor(private readonly settings: GpsSettingsService) {}

  @Get()
  @Roles(...STAFF_ROLES)
  get(@CurrentUser() user: AuthUser) {
    return this.settings.get(user);
  }

  @Patch()
  @Roles('ADMIN')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateGpsSettingsDto) {
    return this.settings.setRetention(user, dto.retentionDays);
  }

  @Post('secret')
  @Roles('ADMIN')
  rotate(@CurrentUser() user: AuthUser) {
    return this.settings.rotateSecret(user);
  }

  @Delete('secret')
  @Roles('ADMIN')
  revoke(@CurrentUser() user: AuthUser) {
    return this.settings.revokeSecret(user);
  }
}
