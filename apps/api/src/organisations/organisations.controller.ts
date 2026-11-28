import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { LimitInviteSending } from '../rate-limit/rate-limit.guard';
import { AllowWhenReadOnly } from '../auth/allow-when-read-only.decorator';
import { TermsService } from './terms.service';
import { AcceptTermsDto } from './dto/terms.dto';

@Controller('organisation')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganisationsController {
  constructor(
    private readonly organisations: OrganisationsService,
    private readonly terms: TermsService,
  ) {}

  @Get()
  @Roles(...STAFF_ROLES, 'CUSTOMER')
  get(@CurrentUser() user: AuthUser) {
    return this.organisations.get(user);
  }

  /** The agreements, what this workspace accepted, and the sub-processors. */
  @Get('terms')
  @Roles(...STAFF_ROLES)
  termsStatus(@CurrentUser() user: AuthUser) {
    return this.terms.status(user);
  }

  /** An Admin accepts for the workspace. Possible while it is read-only. */
  @Post('terms/accept')
  @Roles('ADMIN')
  @HttpCode(200)
  @AllowWhenReadOnly()
  acceptTerms(@CurrentUser() user: AuthUser, @Body() dto: AcceptTermsDto) {
    return this.terms.accept(user, dto.versions);
  }

  @Get('members')
  @Roles('ADMIN')
  members(@CurrentUser() user: AuthUser) {
    return this.organisations.listMembers(user);
  }

  @Post('members/invite')
  @Roles('ADMIN')
  @LimitInviteSending()
  invite(@CurrentUser() user: AuthUser, @Body() dto: InviteStaffDto) {
    return this.organisations.inviteStaff(user, dto);
  }

  @Post('members/:id/resend-invite')
  @Roles('ADMIN')
  @LimitInviteSending()
  resendInvite(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.organisations.resendInvite(user, id);
  }

  @Patch('members/:id')
  @Roles('ADMIN')
  @AllowWhenReadOnly()
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
