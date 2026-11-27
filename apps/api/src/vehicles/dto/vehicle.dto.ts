import {
  IsInt,
  IsOptional,
  IsString,
  Min,
  Matches,
  Max,
  MaxLength,
} from 'class-validator';
import { MAX_YEAR } from '../../common/validators';

export class LookupVehicleDto {
  @IsString()
  @MaxLength(16)
  @Matches(/^[A-Za-z0-9 -]*[A-Za-z0-9][A-Za-z0-9 -]*$/, {
    message: 'Enter a registration using letters and numbers',
  })
  registration!: string;
}

export class CreateVehicleDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  vin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  make?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  variant?: string;

  @IsOptional()
  @IsInt()
  @Min(1886)
  @Max(MAX_YEAR)
  year?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  mileage?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  fuelType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  colour?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  engineSize?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  bodyType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  countryOfRegistration?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  ukRegistration?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  temporaryRegistration?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  cyprusRegistration?: string;
}

export class UpdateVehicleDto extends CreateVehicleDto {}
