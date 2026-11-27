import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IfSent, IsCountryCode } from '../../common/validators';

export class CreateRouteDto {
  @IsString()
  @Length(2, 60)
  name!: string;

  @IsString()
  @Length(1, 16)
  shortLabel!: string;

  @IsString()
  @Length(2, 2)
  @IsCountryCode()
  originCountry!: string;

  @IsString()
  @Length(2, 2)
  @IsCountryCode()
  destinationCountry!: string;

  /** Start as a copy of this route's stages and statuses. Empty when left out. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  copyFromId?: string;
}

export class UpdateRouteDto {
  @IfSent()
  @IsString()
  @Length(2, 60)
  name?: string;

  @IfSent()
  @IsString()
  @Length(1, 16)
  shortLabel?: string;

  @IfSent()
  @IsString()
  @Length(2, 2)
  @IsCountryCode()
  originCountry?: string;

  @IfSent()
  @IsString()
  @Length(2, 2)
  @IsCountryCode()
  destinationCountry?: string;

  @IfSent()
  @IsBoolean()
  active?: boolean;

  @IfSent()
  @IsBoolean()
  isDefault?: boolean;
}

export class StageStatusDto {
  /** Left out for a new status; kept for one being renamed or reordered. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  code?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label!: string;
}

export class SaveStageDto {
  @IsString()
  @Length(1, 40)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  customerName?: string;

  @IsBoolean()
  customerVisible!: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => StageStatusDto)
  statuses!: StageStatusDto[];
}

export class ReorderStagesDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(100)
  @MaxLength(64, { each: true })
  stageIds!: string[];
}

export class RemoveStageDto {
  /** Where the stage's jobs go. Needed only when some jobs are at its statuses. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  moveTo?: string;
}
