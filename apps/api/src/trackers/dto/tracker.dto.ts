import {
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTrackerDto {
  @IsString()
  @MaxLength(64)
  serialNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  provider?: string;
}

export class AssignTrackerDto {
  @IsString()
  trackerId!: string;
}

export class CreateLocationDto {
  @Type(() => Number)
  @IsNumber()
  latitude!: number;

  @Type(() => Number)
  @IsNumber()
  longitude!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  accuracy?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  speed?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  heading?: number;

  @IsOptional()
  @IsISO8601()
  recordedAt?: string;
}
