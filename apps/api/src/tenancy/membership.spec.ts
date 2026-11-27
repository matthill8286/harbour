import { pickActiveMembership } from './membership';

describe('pickActiveMembership', () => {
  const org = { status: 'ACTIVE' as const };
  const base = {
    status: 'ACTIVE',
    organisation: org,
    createdAt: new Date('2026-01-01'),
  };

  it('prefers a staff membership over a portal membership', () => {
    const picked = pickActiveMembership([
      {
        ...base,
        id: 'cust',
        role: 'CUSTOMER',
        createdAt: new Date('2026-08-01'),
      },
      {
        ...base,
        id: 'staff',
        role: 'STAFF',
        createdAt: new Date('2026-01-01'),
      },
    ]);
    expect(picked?.id).toBe('staff');
  });

  it('ignores suspended organisations and disabled memberships', () => {
    const picked = pickActiveMembership([
      {
        id: 'dead',
        role: 'ADMIN',
        status: 'ACTIVE',
        createdAt: new Date('2026-08-01'),
        organisation: { status: 'SUSPENDED' },
      },
      {
        id: 'disabled',
        role: 'ADMIN',
        status: 'DISABLED',
        createdAt: new Date('2026-08-02'),
        organisation: org,
      },
      { ...base, id: 'ok', role: 'STAFF' },
    ]);
    expect(picked?.id).toBe('ok');
  });

  it('returns null when nothing is usable', () => {
    expect(
      pickActiveMembership([
        {
          id: 'x',
          role: 'ADMIN',
          status: 'INVITED',
          createdAt: new Date(),
          organisation: org,
        },
      ]),
    ).toBeNull();
  });
});
