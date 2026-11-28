import type { UserRole } from '@vip/shared';

export type AuthUser = {
  id: string;
  membershipId: string;
  organisationId: string;
  organisationName: string;
  organisationBrandName: string;
  organisationCurrency: string;
  organisationCountry: string;
  email: string;
  name: string;
  role: UserRole;
  customerId: string | null;
  twoFactorEnabled: boolean;
  /** Set when a lapsed plan's notice period has ended. */
  workspaceReadOnly?: boolean;
};
