import type { UserRole } from '@vip/shared';

export type AuthUser = {
  id: string;
  membershipId: string;
  organisationId: string;
  organisationName: string;
  email: string;
  name: string;
  role: UserRole;
  customerId: string | null;
};
