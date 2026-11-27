import type { UserRole } from '@vip/shared';
import type { AuthUser } from './auth.types';

export type AuthOrganisation = {
  name: string;
  currency?: string;
  country?: string;
  settings?: { brandName: string | null } | null;
};

export function organisationBrandName(organisation: AuthOrganisation): string {
  const brand = organisation.settings?.brandName?.trim();
  return brand || organisation.name;
}

export function buildAuthUser(input: {
  id: string;
  email: string;
  name: string;
  twoFactorEnabled?: boolean;
  membership: {
    id: string;
    organisationId: string;
    role: UserRole;
    customerId: string | null;
    organisation: AuthOrganisation;
  };
}): AuthUser {
  return {
    id: input.id,
    membershipId: input.membership.id,
    organisationId: input.membership.organisationId,
    organisationName: input.membership.organisation.name,
    organisationBrandName: organisationBrandName(input.membership.organisation),
    organisationCurrency:
      input.membership.organisation.currency?.trim() || 'EUR',
    organisationCountry: input.membership.organisation.country?.trim() || 'CY',
    email: input.email,
    name: input.name,
    role: input.membership.role,
    customerId: input.membership.customerId,
    twoFactorEnabled: Boolean(input.twoFactorEnabled),
  };
}
