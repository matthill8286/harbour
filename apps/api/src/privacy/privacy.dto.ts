import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PasswordAndCodeDto } from '../auth/two-factor/two-factor.dto';

export class EraseCustomerDto extends PasswordAndCodeDto {
  /** Handed out by the preview, so only what was shown can be erased. */
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, { message: 'Open the preview again.' })
  confirmation!: string;
}

/** Keeping needs no password. Removing needs both factors, as erasing does. */
export class ReviewDecisionDto {
  @IsIn(['KEEP', 'REMOVE'])
  decision!: 'KEEP' | 'REMOVE';

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  password?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\s*\d{3}\s?\d{3}\s*$/, { message: 'Enter the 6-digit code' })
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  backupCode?: string;
}
