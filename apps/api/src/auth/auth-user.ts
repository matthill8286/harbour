import type { UserRole } from '@vip/shared';
import type { AuthUser } from './auth.types';

export function buildAuthUser(input: {
  id: string;
  email: string;
  name: string;
  membership: {
    id: string;
    organisationId: string;
    role: UserRole;
    customerId: string | null;
    organisation: { name: string };
  };
}): AuthUser {
  return {
    id: input.id,
    membershipId: input.membership.id,
    organisationId: input.membership.organisationId,
    organisationName: input.membership.organisation.name,
    email: input.email,
    name: input.name,
    role: input.membership.role,
    customerId: input.membership.customerId,
  };
}
