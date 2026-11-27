import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  MinLength,
  ValidateBy,
} from 'class-validator';
import { IsRealDate } from '../../common/validators';

/** The same slack the GPS gateway is given: a clock a day ahead is broken. */
const MAX_CLOCK_AHEAD_MS = 24 * 60 * 60 * 1000;

function IsNotInTheFuture() {
  return ValidateBy({
    name: 'isNotInTheFuture',
    validator: {
      validate: (value: unknown) =>
        !(
          typeof value === 'string' &&
          new Date(value).getTime() > Date.now() + MAX_CLOCK_AHEAD_MS
        ),
      defaultMessage: () => 'recordedAt cannot be in the future',
    },
  });
}

export class CreateTrackerDto {
  @IsString()
  @MaxLength(64)
  @MinLength(1)
  serialNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  provider?: string;
}

export class AssignTrackerDto {
  @IsString()
  @MaxLength(64)
  trackerId!: string;
}

export class CreateLocationDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999999)
  accuracy?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2000)
  speed?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  @IsOptional()
  @IsRealDate()
  @IsNotInTheFuture()
  recordedAt?: string;
}
