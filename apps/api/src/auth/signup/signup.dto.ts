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

  /** Same minimum as accepting an invite. */
  @IsString()
  @MinLength(10)
  password!: string;
}
