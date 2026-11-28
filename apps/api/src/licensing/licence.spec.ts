import {
  accessFor,
  licenceLimit,
  setUpRefusal,
  type Licence,
  type LicenceStatus,
} from './licence';

const licence = (over: Partial<Licence> = {}): Licence => ({
  id: '2f1c9a34-5b6d-4e7f-8a90-b1c2d3e4f506',
  plan: 'desk',
  status: 'active',
  seats: null,
  limits: {},
  endsAt: null,
  graceEndsAt: null,
  readOnlyEndsAt: null,
  tenant: null,
  owners: ['owner@imports.test'],
  ...over,
});

describe('what a licence allows', () => {
  const access = (status: LicenceStatus) => accessFor(licence({ status }));

  it('gives full use while active or in its grace period', () => {
    expect(access('active')).toBe('full');
    expect(access('grace')).toBe('full');
  });

  it('keeps a workspace readable once its licence has run out, however long ago', () => {
    expect(access('read_only')).toBe('read');
    expect(access('expired')).toBe('read');
  });

  it('shuts a workspace that is suspended, not started or has no licence', () => {
    expect(access('suspended')).toBe('none');
    expect(access('pending')).toBe('none');
    expect(accessFor(null)).toBe('none');
  });
});

describe('who may set a workspace up under a licence', () => {
  it('lets an owner of an unused, active licence, whatever the case of the address', () => {
    expect(setUpRefusal(licence(), ' Owner@Imports.test ')).toBeNull();
  });

  it('says why everyone else may not', () => {
    expect(setUpRefusal(null, 'owner@imports.test')).toBe('licence_not_found');
    expect(
      setUpRefusal(licence({ tenant: 'org1' }), 'owner@imports.test'),
    ).toBe('licence_used');
    expect(
      setUpRefusal(licence({ status: 'suspended' }), 'owner@imports.test'),
    ).toBe('licence_not_active');
    expect(
      setUpRefusal(licence({ status: 'expired' }), 'owner@imports.test'),
    ).toBe('licence_not_active');
    expect(setUpRefusal(licence(), 'someone@else.test')).toBe(
      'licence_not_yours',
    );
  });
});

describe("a licence's own limits", () => {
  it('reads seats as the team limit and importJobsPerMonth as the job limit', () => {
    const l = licence({ seats: 4, limits: { importJobsPerMonth: 30 } });
    expect(licenceLimit(l, 'activeStaff')).toBe(4);
    expect(licenceLimit(l, 'importJobsPerMonth')).toBe(30);
  });

  it('sets no limit where the licence names none', () => {
    expect(licenceLimit(licence(), 'activeStaff')).toBeNull();
    expect(licenceLimit(licence(), 'importJobsPerMonth')).toBeNull();
    expect(licenceLimit(null, 'activeStaff')).toBeNull();
  });
});
