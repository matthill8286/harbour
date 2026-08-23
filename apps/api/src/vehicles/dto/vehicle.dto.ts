import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class LookupVehicleDto {
  @IsString()
  registration!: string;
}

export class CreateVehicleDto {
  @IsOptional()
  @IsString()
  vin?: string;

  @IsOptional()
  @IsString()
  make?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  variant?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  mileage?: number;

  @IsOptional()
  @IsString()
  fuelType?: string;

  @IsOptional()
  @IsString()
  colour?: string;

  @IsOptional()
  @IsString()
  engineSize?: string;

  @IsOptional()
  @IsString()
  bodyType?: string;

  @IsOptional()
  @IsString()
  countryOfRegistration?: string;

  @IsOptional()
  @IsString()
  ukRegistration?: string;

  @IsOptional()
  @IsString()
  temporaryRegistration?: string;

  @IsOptional()
  @IsString()
  cyprusRegistration?: string;
}

export class UpdateVehicleDto extends CreateVehicleDto {}
