import { canManageOrganisation, canWriteStaff, isPortalRole, isStaffRole, ROLE_LABELS } from '@vip/shared';
import { useAuth } from './auth';

export function useSession() {
  const user = useAuth((state) => state.user);
  return {
    user,
    canWrite: user ? canWriteStaff(user.role) : false,
    canManage: user ? canManageOrganisation(user.role) : false,
    isStaff: user ? isStaffRole(user.role) : false,
    isPortal: user ? isPortalRole(user.role) : false,
    workspace: user?.organisationBrandName || user?.organisationName || 'Workspace',
    currency: user?.organisationCurrency || 'EUR',
    country: user?.organisationCountry || 'CY',
    roleLabel: user ? ROLE_LABELS[user.role] : '',
  };
}
