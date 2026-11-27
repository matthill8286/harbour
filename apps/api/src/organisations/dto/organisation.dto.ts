import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  IsTimeZone,
} from 'class-validator';
import { IfSent, IsCountryCode, IsCurrencyCode } from '../../common/validators';

export class UpdateOrganisationDto {
  @IfSent()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  legalName?: string;

  @IfSent()
  @IsString()
  @MaxLength(80)
  brandName?: string;

  @IfSent()
  @IsString()
  @MaxLength(64)
  @IsTimeZone()
  timezone?: string;

  @IfSent()
  @IsString()
  @IsCurrencyCode()
  currency?: string;

  @IfSent()
  @IsString()
  @IsCountryCode()
  country?: string;
}
