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
        organisation: { name: 'Demo Imports', currency: 'GBP', country: 'GB', settings: { brandName: 'Demo Desk' } },
      },
    });
    expect(user.organisationId).toBe('org-a');
    expect(user.membershipId).toBe('mem-1');
    expect(user.role).toBe('OWNER');
    expect(user.organisationBrandName).toBe('Demo Desk');
    expect(user.organisationName).toBe('Demo Imports');
    expect(user.organisationCurrency).toBe('GBP');
    expect(user.organisationCountry).toBe('GB');
  });

  it('falls back to the organisation name, EUR and CY when branding and locale are missing', () => {
    const user = buildAuthUser({
      id: 'user-1',
      email: 'alex@demo.local',
      name: 'Alex',
      membership: {
        id: 'mem-1',
        organisationId: 'org-a',
        role: 'STAFF',
        customerId: null,
        organisation: { name: 'Demo Imports' },
      },
    });
    expect(user.organisationBrandName).toBe('Demo Imports');
    expect(user.organisationCurrency).toBe('EUR');
    expect(user.organisationCountry).toBe('CY');
  });
});
