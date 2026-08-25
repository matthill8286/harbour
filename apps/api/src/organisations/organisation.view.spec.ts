import { presentOrganisation } from './organisation.view';

describe('presentOrganisation', () => {
  const base = {
    id: 'org-1',
    name: 'Demo Imports Ltd',
    legalName: 'Demo Imports Ltd',
    slug: 'demo-imports',
    timezone: 'Europe/Nicosia',
    currency: 'EUR',
    country: 'CY',
    status: 'ACTIVE',
    settings: { brandName: 'Demo Imports', primaryContact: null },
    subscription: { plan: 'BUSINESS', status: 'ACTIVE', billingCycle: 'MONTHLY' },
    features: [
      { flag: 'GPS_TRACKING', enabled: true },
      { flag: 'CUSTOMER_PORTAL', enabled: true },
    ],
  };

  it('uses brand name for workspace display and keeps the legal name separate', () => {
    const view = presentOrganisation(base);
    expect(view.brandName).toBe('Demo Imports');
    expect(view.name).toBe('Demo Imports Ltd');
    expect(view.features).toEqual({ GPS_TRACKING: true, CUSTOMER_PORTAL: true });
  });

  it('falls back to the organisation name when branding is empty', () => {
    expect(presentOrganisation({ ...base, settings: { brandName: '  ', primaryContact: null } }).brandName).toBe(
      'Demo Imports Ltd',
    );
  });
});
