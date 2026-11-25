import { isStaffRole } from '@vip/shared';
import type { AuthUser } from '../auth.types';

/**
 * Staff must switch on two-factor sign-in before they touch workspace data, as in Kleidi.
 * Customers use the portal and may turn it on, but are not made to.
 */
export function mustSetUpTwoFactor(user: AuthUser): boolean {
  return isStaffRole(user.role) && !user.twoFactorEnabled;
}
