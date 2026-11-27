import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  /** Same minimum as accepting an invite or resetting a password. */
  @IsString()
  @MinLength(10)
  newPassword!: string;
}
