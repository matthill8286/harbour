import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { RateLimit } from '../../rate-limit/rate-limit.guard';
import { ForgotPasswordDto, ResetPasswordDto } from './password-reset.dto';
import { PasswordResetService } from './password-reset.service';

@Controller('auth/password')
export class PasswordResetController {
  constructor(private readonly resets: PasswordResetService) {}

  @Post('forgot')
  @HttpCode(204)
  @RateLimit({ policy: 'forgotPasswordIp', by: 'ip' })
  forgot(@Body() dto: ForgotPasswordDto) {
    this.resets.requestInBackground(dto.email);
  }

  @Get('reset/:token')
  @RateLimit({ policy: 'resetPasswordIp', by: 'ip' })
  check(@Param('token') token: string) {
    return this.resets.check(token);
  }

  @Post('reset')
  @HttpCode(204)
  @RateLimit({ policy: 'resetPasswordIp', by: 'ip' })
  async reset(@Body() dto: ResetPasswordDto) {
    await this.resets.reset(dto.token, dto.password);
  }
}
