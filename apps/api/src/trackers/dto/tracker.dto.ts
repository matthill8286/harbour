import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  MinLength,
  ValidateBy,
} from 'class-validator';
import {
  MAX_REPORT_INTERVAL_MINUTES,
  MIN_REPORT_INTERVAL_MINUTES,
  TRACKER_POWER_SOURCES,
  type TrackerPowerSource,
} from '@vip/shared';
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

/** How a unit is powered and fitted, and how often it reports. */
export class TrackerDetailsDto {
  @IsOptional()
  @IsIn(TRACKER_POWER_SOURCES)
  powerSource?: TrackerPowerSource;

  @IsOptional()
  @IsInt()
  @Min(MIN_REPORT_INTERVAL_MINUTES)
  @Max(MAX_REPORT_INTERVAL_MINUTES)
  reportIntervalMinutes?: number;

  /** The fitter of a hard-wired or diagnostic-port unit. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fittedBy?: string;

  @IsOptional()
  @IsRealDate()
  @IsNotInTheFuture()
  fittedAt?: string;

  @IsOptional()
  @IsBoolean()
  ownerPermissionHeld?: boolean;
}

export class CreateTrackerDto extends TrackerDetailsDto {
  @IsString()
  @MaxLength(64)
  @MinLength(1)
  serialNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  provider?: string;

  /**
   * The person ticked the lawful-use statement for the unit's power source.
   * A real unit cannot be registered without it.
   */
  @IsOptional()
  @IsBoolean()
  statementConfirmed?: boolean;

  /** The version of the statement they saw. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  statementVersion?: string;
}

export class UpdateTrackerDto extends TrackerDetailsDto {}

/** Taking a unit off a job, and whether it is already out of the vehicle. */
export class UnassignTrackerDto {
  @IsOptional()
  @IsBoolean()
  unitRemoved?: boolean;

  /** Required for a hard-wired or diagnostic-port unit that was taken out. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  removalFitter?: string;
}

export class ConfirmRemovalDto {
  @Equals(true)
  unitRemoved!: true;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  removalFitter?: string;
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
