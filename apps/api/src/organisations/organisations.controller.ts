import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { STAFF_READ_ROLES } from '@vip/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { OrganisationsService } from './organisations.service';
import { UpdateOrganisationDto } from './dto/organisation.dto';

@Controller('organisation')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganisationsController {
  constructor(private readonly organisations: OrganisationsService) {}

  @Get()
  @Roles(...STAFF_READ_ROLES, 'CUSTOMER')
  get(@CurrentUser() user: AuthUser) {
    return this.organisations.get(user);
  }

  @Get('members')
  @Roles('OWNER', 'ADMIN')
  members(@CurrentUser() user: AuthUser) {
    return this.organisations.listMembers(user);
  }

  @Patch()
  @Roles('OWNER', 'ADMIN')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateOrganisationDto) {
    return this.organisations.update(user, dto);
  }
}
