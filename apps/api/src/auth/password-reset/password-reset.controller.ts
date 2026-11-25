import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ForgotPasswordDto, ResetPasswordDto } from './password-reset.dto';
import { PasswordResetService } from './password-reset.service';

@Controller('auth/password')
export class PasswordResetController {
  constructor(private readonly resets: PasswordResetService) {}

  @Post('forgot')
  @HttpCode(204)
  async forgot(@Body() dto: ForgotPasswordDto) {
    await this.resets.request(dto.email);
  }

  @Get('reset/:token')
  check(@Param('token') token: string) {
    return this.resets.check(token);
  }

  @Post('reset')
  @HttpCode(204)
  async reset(@Body() dto: ResetPasswordDto) {
    await this.resets.reset(dto.token, dto.password);
  }
}
