import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AllowWhenReadOnly } from '../auth/allow-when-read-only.decorator';
import type { AuthUser } from '../auth/auth.types';
import { RateLimit } from '../rate-limit/rate-limit.guard';
import { WorkspaceExportService } from './workspace-export.service';

/**
 * The whole workspace's data, for its Admins. It stays open while a lapsed plan
 * has made the workspace read-only, and while it waits to be deleted.
 */
@Controller('organisation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@AllowWhenReadOnly()
export class WorkspaceExportController {
  constructor(private readonly exports: WorkspaceExportService) {}

  @Get('export')
  @RateLimit({ policy: 'workspaceExport', by: 'user' })
  export(@CurrentUser() user: AuthUser) {
    return this.exports.export(user);
  }
}
