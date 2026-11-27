import { IsString, MinLength } from 'class-validator';
import { TrimmedEmail } from '../../common/trimmed-email';

export class ForgotPasswordDto {
  @TrimmedEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  token!: string;

  /** Same minimum as accepting an invite. */
  @IsString()
  @MinLength(10)
  password!: string;
}
