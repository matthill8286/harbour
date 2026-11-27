import { IsString, MinLength } from 'class-validator';
import { TrimmedEmail } from '../../common/trimmed-email';

export class LoginDto {
  @TrimmedEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
