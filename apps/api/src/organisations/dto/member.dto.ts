import { IsIn, IsString, MinLength, MaxLength } from 'class-validator';
import { TrimmedEmail } from '../../common/trimmed-email';
import { INVITEABLE_STAFF_ROLES } from '@vip/shared';
import { UpdateOrganisationDto } from './organisation.dto';
import { IfSent } from '../../common/validators';

export { UpdateOrganisationDto };

export class InviteStaffDto {
  @TrimmedEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsIn([...INVITEABLE_STAFF_ROLES])
  role!: (typeof INVITEABLE_STAFF_ROLES)[number];
}

export class UpdateMemberDto {
  @IfSent()
  @IsIn([...INVITEABLE_STAFF_ROLES])
  role?: (typeof INVITEABLE_STAFF_ROLES)[number];

  @IfSent()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';
}
