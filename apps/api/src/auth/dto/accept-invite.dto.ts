import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AcceptInviteDto {
  /**
   * A new password for a new account, which must be at least 10 characters, or
   * the current password of an account that already has one.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  password!: string;

  /** Needed when the existing account has two-factor sign-in on. */
  @IsOptional()
  @IsString()
  @Matches(/^\s*\d{3}\s?\d{3}\s*$/, { message: 'Enter the 6-digit code' })
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  backupCode?: string;
}
