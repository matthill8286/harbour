import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
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

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user, dto.name);
  }

  /** Returns a new session, because the change signs out every existing one. */
  @Post('password/change')
  @UseGuards(JwtAuthGuard)
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user, dto.currentPassword, dto.newPassword);
  }

  @Get('invites/:token')
  previewInvite(@Param('token') token: string) {
    return this.auth.previewInvite(token);
  }

  @Post('invites/:token/accept')
  acceptInvite(@Param('token') token: string, @Body() dto: AcceptInviteDto) {
    return this.auth.acceptInvite(token, dto);
  }
}
