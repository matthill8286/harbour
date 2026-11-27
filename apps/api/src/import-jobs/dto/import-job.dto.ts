import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  IsInt,
  Max,
} from 'class-validator';
import {
  CHARGE_CATEGORIES,
  COST_CATEGORIES,
  DOCUMENT_TYPES,
  JOURNEY_STATUSES,
  JOURNEY_TYPES,
  NOTE_VISIBILITIES,
  PHOTO_CATEGORIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '@vip/shared';
import {
  IfSent,
  IsCountryCode,
  IsCurrencyCode,
  IsRealDate,
  MAX_YEAR,
} from '../../common/validators';

/** The most a money line can be. The column holds just under ten billion. */
const MAX_AMOUNT = 1_000_000_000;

export class CreateImportJobDto {
  /** The route the job follows. The workspace's default when left out. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  routeId?: string;

  @IsString()
  @MaxLength(64)
  customerId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  vehicleId?: string;

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
  @IsCountryCode()
  originCountry?: string;

  @IsOptional()
  @IsString()
  @IsCountryCode()
  destinationCountry?: string;

  @IsOptional()
  @IsString()
  @IsCountryCode()
  registrationCountry?: string;

  @IsOptional()
  @IsRealDate()
  expectedDeliveryDate?: string;
}

export class UpdateImportJobDto {
  @IfSent()
  @IsString()
  @IsCountryCode()
  originCountry?: string;

  @IfSent()
  @IsString()
  @IsCountryCode()
  destinationCountry?: string;

  @IsOptional()
  @IsString()
  @IsCountryCode()
  registrationCountry?: string;

  @IsOptional()
  @IsRealDate()
  expectedDeliveryDate?: string | null;

  /** Assign or clear a curated UK→BG→GR corridor template. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  routeTemplateId?: string | null;
}

export class ChangeStatusDto {
  /** A status of the job's route, or COMPLETED or CANCELLED. The route decides which moves are allowed. */
  @IsString()
  @MaxLength(60)
  @MinLength(1)
  status!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: (typeof TASK_STATUSES)[number];

  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: (typeof TASK_PRIORITIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignedToId?: string;

  @IsOptional()
  @IsRealDate()
  dueDate?: string;
}

export class UpdateTaskDto {
  @IfSent()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IfSent()
  @IsIn(TASK_STATUSES)
  status?: (typeof TASK_STATUSES)[number];

  @IfSent()
  @IsIn(TASK_PRIORITIES)
  priority?: (typeof TASK_PRIORITIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignedToId?: string | null;

  @IsOptional()
  @IsRealDate()
  dueDate?: string | null;
}

export class CreateCostDto {
  @IsIn(COST_CATEGORIES)
  category!: (typeof COST_CATEGORIES)[number];

  /** Required when the category is Other; see moneyLineProblem. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsNumber()
  @Min(0)
  @Max(MAX_AMOUNT)
  amount!: number;

  @IsOptional()
  @IsString()
  @IsCurrencyCode()
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  invoiceReference?: string;

  @IsOptional()
  @IsRealDate()
  incurredOn?: string;
}

export class CreateChargeDto {
  @IsIn(CHARGE_CATEGORIES)
  category!: (typeof CHARGE_CATEGORIES)[number];

  /** Required when the category is Other; see moneyLineProblem. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsNumber()
  @Min(0)
  @Max(MAX_AMOUNT)
  amount!: number;

  @IsOptional()
  @IsString()
  @IsCurrencyCode()
  currency?: string;

  @IsOptional()
  @IsRealDate()
  incurredOn?: string;
}

export class UpdateCostDto {
  @IfSent()
  @IsIn(COST_CATEGORIES)
  category?: (typeof COST_CATEGORIES)[number];

  @IfSent()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IfSent()
  @IsNumber()
  @Min(0)
  @Max(MAX_AMOUNT)
  amount?: number;
}

export class UpdateChargeDto {
  @IfSent()
  @IsIn(CHARGE_CATEGORIES)
  category?: (typeof CHARGE_CATEGORIES)[number];

  @IfSent()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IfSent()
  @IsNumber()
  @Min(0)
  @Max(MAX_AMOUNT)
  amount?: number;
}

export class CreateNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  @IsOptional()
  @IsIn(NOTE_VISIBILITIES)
  visibility?: (typeof NOTE_VISIBILITIES)[number];
}

export class DraftCustomerNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  intent!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  tone?: string;
}

export class CreateJourneyDto {
  @IsOptional()
  @IsIn(JOURNEY_TYPES)
  type?: (typeof JOURNEY_TYPES)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  origin!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  destination!: string;

  @IsOptional()
  @IsIn(JOURNEY_STATUSES)
  status?: (typeof JOURNEY_STATUSES)[number];

  @IsOptional()
  @IsRealDate()
  startedAt?: string;

  @IsOptional()
  @IsRealDate()
  completedAt?: string;
}

export class UploadMetaDto {
  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  type?: (typeof DOCUMENT_TYPES)[number];

  @IsOptional()
  @IsIn(PHOTO_CATEGORIES)
  category?: (typeof PHOTO_CATEGORIES)[number];

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  customerVisible?: boolean;
}

export class UpdateFileVisibilityDto {
  @IsBoolean()
  customerVisible!: boolean;
}
