import { IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTrackerDto {
  @IsString()
  serialNumber!: string;

  @IsOptional()
  @IsString()
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
  recordedAt?: string;
}
