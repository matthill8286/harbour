import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../current-user.decorator';
import { JwtAuthGuard } from '../jwt-auth.guard';
import type { AuthUser } from '../auth.types';
import { AuthService } from '../auth.service';
import { AllowWithoutTwoFactor } from './allow-without-two-factor.decorator';
import {
  ChallengeDto,
  PasswordAndCodeDto,
  PasswordDto,
  VerifyCodeDto,
} from './two-factor.dto';
import { TwoFactorService } from './two-factor.service';
import { RateLimit } from '../../rate-limit/rate-limit.guard';

@Controller('auth/two-factor')
export class TwoFactorController {
  constructor(
    private readonly twoFactor: TwoFactorService,
    private readonly auth: AuthService,
  ) {}

  /** Second step of sign-in: swaps the challenge token and a code for a session. */
  @Post('challenge')
  @RateLimit({ policy: 'twoFactorIp', by: 'ip' })
  @HttpCode(200)
  challenge(@Body() dto: ChallengeDto) {
    if (!dto.code && !dto.backupCode) {
      throw new BadRequestException('Enter a code from your authenticator app');
    }
    return this.auth.completeTwoFactorChallenge(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @AllowWithoutTwoFactor()
  status(@CurrentUser() user: AuthUser) {
    return this.twoFactor.status(user);
  }

  @Post('enable')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @AllowWithoutTwoFactor()
  enable(@CurrentUser() user: AuthUser, @Body() dto: PasswordDto) {
    return this.twoFactor.enable(user, dto.password);
  }

  @Post('verify')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @AllowWithoutTwoFactor()
  verify(@CurrentUser() user: AuthUser, @Body() dto: VerifyCodeDto) {
    return this.twoFactor.verifyEnrolment(user, dto.code);
  }

  @Post('disable')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @AllowWithoutTwoFactor()
  disable(@CurrentUser() user: AuthUser, @Body() dto: PasswordAndCodeDto) {
    return this.twoFactor.disable(user, dto.password, dto);
  }

  @Post('backup-codes')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  regenerateBackupCodes(
    @CurrentUser() user: AuthUser,
    @Body() dto: PasswordAndCodeDto,
  ) {
    return this.twoFactor.regenerateBackupCodes(user, dto.password, dto);
  }
}
