import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { RateLimit } from '../../rate-limit/rate-limit.guard';
import { ConfirmSignupDto, SignupDto } from './signup.dto';
import { SignupService } from './signup.service';

@Controller('auth/signup')
export class SignupController {
  constructor(private readonly signups: SignupService) {}

  /** The same empty answer whether or not the email has an account. */
  @Post()
  @HttpCode(204)
  @RateLimit({ policy: 'signupIp', by: 'ip' })
  async request(@Body() dto: SignupDto) {
    await this.signups.request(dto);
  }

  @Get('confirm/:token')
  @RateLimit({ policy: 'signupConfirmIp', by: 'ip' })
  check(@Param('token') token: string) {
    return this.signups.check(token);
  }

  @Post('confirm')
  @RateLimit({ policy: 'signupConfirmIp', by: 'ip' })
  confirm(@Body() dto: ConfirmSignupDto) {
    return this.signups.confirm(dto.token, dto.password);
  }
}
