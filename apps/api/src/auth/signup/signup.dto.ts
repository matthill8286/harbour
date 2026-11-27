import { IsString, MaxLength, MinLength } from 'class-validator';
import { TrimmedEmail } from '../../common/trimmed-email';

export class SignupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  organisationName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @TrimmedEmail()
  email!: string;
}

export class ConfirmSignupDto {
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
