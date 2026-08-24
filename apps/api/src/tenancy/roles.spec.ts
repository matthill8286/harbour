import { canWriteStaff, isPortalRole, isStaffRole } from '@vip/shared';

describe('organisation roles', () => {
  it('treats OWNER as staff with write access', () => {
    expect(isStaffRole('OWNER')).toBe(true);
    expect(canWriteStaff('OWNER')).toBe(true);
    expect(isPortalRole('OWNER')).toBe(false);
  });

  it('treats VIEWER as staff without write access', () => {
    expect(isStaffRole('VIEWER')).toBe(true);
    expect(canWriteStaff('VIEWER')).toBe(false);
  });

  it('keeps CUSTOMER on the portal permission model', () => {
    expect(isStaffRole('CUSTOMER')).toBe(false);
    expect(isPortalRole('CUSTOMER')).toBe(true);
    expect(canWriteStaff('CUSTOMER')).toBe(false);
  });
});
