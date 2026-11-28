import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
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

  /** The licence the workspace is set up under. Needed wherever licences are checked. */
  @IsOptional()
  @IsUUID()
  licenceId?: string;
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
