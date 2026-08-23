import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthUser } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return user;
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
