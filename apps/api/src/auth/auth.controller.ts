import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { ChangePasswordDto, UpdateProfileDto } from './dto/account.dto';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthUser } from './auth.types';
import { AllowWithoutTwoFactor } from './two-factor/allow-without-two-factor.decorator';
import { RateLimit } from '../rate-limit/rate-limit.guard';
import type { Request } from 'express';
import { AllowWhenReadOnly } from './allow-when-read-only.decorator';
import { SwitchOrganisationDto } from './dto/switch-organisation.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @RateLimit({ policy: 'loginIp', by: 'ip' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  // Allowed before two-factor setup, so the web app knows where to send the user next.
  @AllowWithoutTwoFactor()
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Get('organisations')
  @UseGuards(JwtAuthGuard)
  organisations(@CurrentUser() user: AuthUser) {
    return this.auth.listOrganisations(user);
  }

  /** Returns a new session for the other workspace. */
  @Post('organisations/switch')
  @UseGuards(JwtAuthGuard)
  @RateLimit({ policy: 'twoFactorIp', by: 'ip' })
  @AllowWhenReadOnly()
  switchOrganisation(
    @CurrentUser() user: AuthUser,
    @Body() dto: SwitchOrganisationDto,
    @Req() request: Request,
  ) {
    const token = request.headers.authorization?.split(' ')[1] ?? '';
    return this.auth.switchOrganisation(user, dto, token);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @AllowWhenReadOnly()
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user, dto.name);
  }

  /** Returns a new session, because the change signs out every existing one. */
  @Post('password/change')
  @UseGuards(JwtAuthGuard)
  @AllowWhenReadOnly()
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user, dto.currentPassword, dto.newPassword);
  }

  @Get('invites/:token')
  @RateLimit({ policy: 'invitePreviewIp', by: 'ip' })
  previewInvite(@Param('token') token: string) {
    return this.auth.previewInvite(token);
  }

  @Post('invites/:token/accept')
  @RateLimit({ policy: 'inviteAcceptIp', by: 'ip' })
  acceptInvite(@Param('token') token: string, @Body() dto: AcceptInviteDto) {
    return this.auth.acceptInvite(token, dto);
  }
}
