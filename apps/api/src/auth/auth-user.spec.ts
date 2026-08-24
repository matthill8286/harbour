import { buildAuthUser } from './auth-user';

describe('buildAuthUser', () => {
  it('takes organisation context from the membership, not a client-supplied id', () => {
    const user = buildAuthUser({
      id: 'user-1',
      email: 'alex@demo.local',
      name: 'Alex',
      membership: {
        id: 'mem-1',
        organisationId: 'org-a',
        role: 'OWNER',
        customerId: null,
        organisation: { name: 'Demo Imports' },
      },
    });
    expect(user.organisationId).toBe('org-a');
    expect(user.membershipId).toBe('mem-1');
    expect(user.role).toBe('OWNER');
  });
});
