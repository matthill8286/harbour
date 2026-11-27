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
import { OrganisationsService } from './organisations.service';
import { UpdateOrganisationDto } from './dto/organisation.dto';
import { InviteStaffDto, UpdateMemberDto } from './dto/member.dto';

@Controller('organisation')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganisationsController {
  constructor(private readonly organisations: OrganisationsService) {}

  @Get()
  @Roles(...STAFF_ROLES, 'CUSTOMER')
  get(@CurrentUser() user: AuthUser) {
    return this.organisations.get(user);
  }

  @Get('members')
  @Roles('ADMIN')
  members(@CurrentUser() user: AuthUser) {
    return this.organisations.listMembers(user);
  }

  @Post('members/invite')
  @Roles('ADMIN')
  invite(@CurrentUser() user: AuthUser, @Body() dto: InviteStaffDto) {
    return this.organisations.inviteStaff(user, dto);
  }

  @Post('members/:id/resend-invite')
  @Roles('ADMIN')
  resendInvite(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.organisations.resendInvite(user, id);
  }

  @Patch('members/:id')
  @Roles('ADMIN')
  updateMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.organisations.updateMember(user, id, dto);
  }

  @Patch()
  @Roles('ADMIN')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateOrganisationDto) {
    return this.organisations.update(user, dto);
  }
}
