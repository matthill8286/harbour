import {
  canManageOrganisation,
  canWriteStaff,
  isPortalRole,
  isStaffRole,
  USER_ROLES,
} from '@vip/shared';

describe('organisation roles', () => {
  it('has three roles: Admin, Staff and Customer', () => {
    expect(USER_ROLES).toEqual(['ADMIN', 'STAFF', 'CUSTOMER']);
  });

  it('lets Admin and Staff work on jobs, and only Admin manage the workspace', () => {
    expect(canWriteStaff('ADMIN')).toBe(true);
    expect(canWriteStaff('STAFF')).toBe(true);
    expect(canManageOrganisation('ADMIN')).toBe(true);
    expect(canManageOrganisation('STAFF')).toBe(false);
  });

  it('keeps customers on the portal', () => {
    expect(isStaffRole('CUSTOMER')).toBe(false);
    expect(isPortalRole('CUSTOMER')).toBe(true);
    expect(canWriteStaff('CUSTOMER')).toBe(false);
    expect(canManageOrganisation('CUSTOMER')).toBe(false);
  });
});
