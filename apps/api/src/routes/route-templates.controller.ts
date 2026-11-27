import { Controller, Get, UseGuards } from '@nestjs/common';
import { STAFF_ROLES } from '@vip/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { RouteTemplatesService } from './route-templates.service';

@Controller('route-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STAFF_ROLES)
export class RouteTemplatesController {
  constructor(private readonly routes: RouteTemplatesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.routes.list(user);
  }
}
