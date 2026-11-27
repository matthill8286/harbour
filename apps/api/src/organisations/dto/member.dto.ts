import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { TrimmedEmail } from '../../common/trimmed-email';
import { INVITEABLE_STAFF_ROLES } from '@vip/shared';
import { UpdateOrganisationDto } from './organisation.dto';

export { UpdateOrganisationDto };

export class InviteStaffDto {
  @TrimmedEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsIn([...INVITEABLE_STAFF_ROLES])
  role!: (typeof INVITEABLE_STAFF_ROLES)[number];
}

export class UpdateMemberDto {
  @IsOptional()
  @IsIn([...INVITEABLE_STAFF_ROLES])
  role?: (typeof INVITEABLE_STAFF_ROLES)[number];

  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';
}
