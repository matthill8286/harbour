import { IsEmail, IsString, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
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
