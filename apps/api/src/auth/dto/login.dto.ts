import { IsString, MinLength, MaxLength } from 'class-validator';
import { TrimmedEmail } from '../../common/trimmed-email';

export class LoginDto {
  @TrimmedEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(1024)
  password!: string;
}
