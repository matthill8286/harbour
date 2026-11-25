import { Body, Controller, Post } from '@nestjs/common';
import { SignupDto } from './signup.dto';
import { SignupService } from './signup.service';

@Controller('auth')
export class SignupController {
  constructor(private readonly signups: SignupService) {}

  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.signups.signup(dto);
  }
}
