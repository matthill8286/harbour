import { IsString, MinLength, MaxLength } from 'class-validator';
import { TrimmedEmail } from '../../common/trimmed-email';

export class ForgotPasswordDto {
  @TrimmedEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token!: string;

  /** Same minimum as accepting an invite. */
  @IsString()
  @MinLength(10)
  @MaxLength(1024)
  password!: string;
}
