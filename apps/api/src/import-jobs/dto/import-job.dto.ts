import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
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

export class CreateImportJobDto {
  /** The route the job follows. The workspace's default when left out. */
  @IsOptional()
  @IsString()
  routeId?: string;

  @IsString()
  customerId!: string;

  @IsOptional()
  @IsString()
  vehicleId?: string;

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
  @IsNumber()
  year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
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
  originCountry?: string;

  @IsOptional()
  @IsString()
  destinationCountry?: string;

  @IsOptional()
  @IsString()
  registrationCountry?: string;

  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;
}

export class UpdateImportJobDto {
  @IsOptional()
  @IsString()
  originCountry?: string;

  @IsOptional()
  @IsString()
  destinationCountry?: string;

  @IsOptional()
  @IsString()
  registrationCountry?: string;

  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string | null;

  /** Assign or clear a curated UK→BG→GR corridor template. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  routeTemplateId?: string | null;
}

export class ChangeStatusDto {
  /** A status of the job's route, or COMPLETED or CANCELLED. The route decides which moves are allowed. */
  @IsString()
  @MaxLength(60)
  status!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: (typeof TASK_STATUSES)[number];

  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: (typeof TASK_PRIORITIES)[number];

  @IsOptional()
  @IsString()
  assignedToId?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: (typeof TASK_STATUSES)[number];

  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: (typeof TASK_PRIORITIES)[number];

  @IsOptional()
  @IsString()
  assignedToId?: string | null;

  @IsOptional()
  @IsDateString()
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

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  supplier?: string;

  @IsOptional()
  @IsString()
  invoiceReference?: string;

  @IsOptional()
  @IsDateString()
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

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsDateString()
  incurredOn?: string;
}

export class UpdateCostDto {
  @IsOptional()
  @IsIn(COST_CATEGORIES)
  category?: (typeof COST_CATEGORIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;
}

export class UpdateChargeDto {
  @IsOptional()
  @IsIn(CHARGE_CATEGORIES)
  category?: (typeof CHARGE_CATEGORIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;
}

export class CreateNoteDto {
  @IsString()
  @MinLength(1)
  body!: string;

  @IsOptional()
  @IsIn(NOTE_VISIBILITIES)
  visibility?: (typeof NOTE_VISIBILITIES)[number];
}

export class DraftCustomerNoteDto {
  @IsString()
  @MinLength(1)
  intent!: string;

  @IsOptional()
  @IsString()
  tone?: string;
}

export class CreateJourneyDto {
  @IsOptional()
  @IsIn(JOURNEY_TYPES)
  type?: (typeof JOURNEY_TYPES)[number];

  @IsString()
  origin!: string;

  @IsString()
  destination!: string;

  @IsOptional()
  @IsIn(JOURNEY_STATUSES)
  status?: (typeof JOURNEY_STATUSES)[number];

  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @IsOptional()
  @IsDateString()
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
