import { describePortalAccess } from './portal-access';

describe('describePortalAccess', () => {
  const user = { id: 'user-1', email: 'maria@example.com', hasPassword: false };
  const pendingInvite = {
    createdAt: new Date('2026-08-23T10:00:00.000Z'),
    expiresAt: new Date('2026-08-30T10:00:00.000Z'),
  };

  it('is NONE when the customer has no portal user', () => {
    expect(
      describePortalAccess({ user: null, pendingInvite: null }).status,
    ).toBe('NONE');
  });

  it('is INVITED when a user exists without a password and a live invite', () => {
    const access = describePortalAccess({ user, pendingInvite });
    expect(access.status).toBe('INVITED');
    expect(access.email).toBe('maria@example.com');
    expect(access.expiresAt).toEqual(pendingInvite.expiresAt);
  });

  it('is ACTIVE once a password has been set, even if a reset invite is open', () => {
    const access = describePortalAccess({
      user: { ...user, hasPassword: true },
      pendingInvite,
    });
    expect(access.status).toBe('ACTIVE');
    expect(access.userId).toBe('user-1');
  });
});
