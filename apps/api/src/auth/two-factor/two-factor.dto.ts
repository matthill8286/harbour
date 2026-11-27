import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class PasswordDto {
  @IsString()
  @MinLength(1)
  password!: string;
}

/** For changes that weaken the account's sign-in, which need both factors. */
export class PasswordAndCodeDto extends PasswordDto {
  @IsOptional()
  @IsString()
  @Matches(/^\s*\d{3}\s?\d{3}\s*$/, { message: 'Enter the 6-digit code' })
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  backupCode?: string;
}

export class VerifyCodeDto {
  @IsString()
  @Matches(/^\s*\d{3}\s?\d{3}\s*$/, { message: 'Enter the 6-digit code' })
  code!: string;
}

export class ChallengeDto {
  @IsString()
  @MinLength(1)
  challengeToken!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\s*\d{3}\s?\d{3}\s*$/, { message: 'Enter the 6-digit code' })
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  backupCode?: string;
}
