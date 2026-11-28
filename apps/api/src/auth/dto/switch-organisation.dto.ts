import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class SwitchOrganisationDto {
  /** The caller's own membership of the workspace to move to. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  membershipId!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\s*\d{3}\s?\d{3}\s*$/, { message: 'Enter the 6-digit code' })
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  backupCode?: string;
}
