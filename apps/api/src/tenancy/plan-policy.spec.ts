import { ForbiddenException } from '@nestjs/common';
import {
  assertWithinPlan,
  PLAN_LIMITS,
  type PlanLimitTable,
} from './plan-policy';

const database = (plan = 'STARTER') => ({
  subscription: { findUnique: jest.fn().mockResolvedValue({ plan }) },
});
const limited: PlanLimitTable = {
  ...PLAN_LIMITS,
  STARTER: { importJobsPerMonth: null, activeStaff: 2 },
};

describe('plan limits', () => {
  it('sets none today', () => {
    for (const plan of Object.values(PLAN_LIMITS)) {
      expect(plan).toEqual({ importJobsPerMonth: null, activeStaff: null });
    }
  });

  it('asks the database nothing while there is no limit', async () => {
    const db = database();
    const used = jest.fn();
    await assertWithinPlan(db as never, 'org', 'activeStaff', used);
    expect(db.subscription.findUnique).not.toHaveBeenCalled();
    expect(used).not.toHaveBeenCalled();
  });

  it('allows up to a defined limit and refuses past it', async () => {
    const check = (used: number, plan?: string) =>
      assertWithinPlan(
        database(plan) as never,
        'org',
        'activeStaff',
        () => used,
        limited,
      );
    await expect(check(2)).resolves.toBeUndefined();
    await expect(check(3)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(check(3, 'BUSINESS')).resolves.toBeUndefined();
  });

  describe("with a licence's own limit", () => {
    it('applies it where the plan sets none, without reading the subscription', async () => {
      const db = database();
      await expect(
        assertWithinPlan(
          db as never,
          'org',
          'activeStaff',
          () => 3,
          PLAN_LIMITS,
          3,
        ),
      ).resolves.toBeUndefined();
      await expect(
        assertWithinPlan(
          db as never,
          'org',
          'activeStaff',
          () => 4,
          PLAN_LIMITS,
          3,
        ),
      ).rejects.toMatchObject({ response: { code: 'plan_limit_reached' } });
      expect(db.subscription.findUnique).not.toHaveBeenCalled();
    });

    it('applies the lower of the plan and the licence', async () => {
      const within = (used: number, licenceLimit: number | null) =>
        assertWithinPlan(
          database() as never,
          'org',
          'activeStaff',
          () => used,
          limited,
          licenceLimit,
        );
      await expect(within(2, 5)).resolves.toBeUndefined();
      await expect(within(3, 5)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(within(2, 1)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(within(2, null)).resolves.toBeUndefined();
    });

    it('counts monthly import jobs against the licence', async () => {
      await expect(
        assertWithinPlan(
          database() as never,
          'org',
          'importJobsPerMonth',
          () => 21,
          PLAN_LIMITS,
          20,
        ),
      ).rejects.toMatchObject({
        response: { message: 'Your plan allows 20 new import jobs a month.' },
      });
    });
  });
});
