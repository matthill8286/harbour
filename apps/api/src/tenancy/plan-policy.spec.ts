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
});
