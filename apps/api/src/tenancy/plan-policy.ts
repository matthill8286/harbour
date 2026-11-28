/**
 * Every rule a plan puts on a workspace is here, and the server checks them.
 *
 * No limit is set. The limits wait until they are defined, so each is `null`,
 * which means no limit and costs no query. Nothing here deletes data, and
 * reading and exporting are never blocked.
 */
import { ForbiddenException } from '@nestjs/common';
import type { Prisma, SubscriptionPlan } from '@prisma/client';

export type PlanLimits = {
  /** Import jobs created in one UTC month. */
  importJobsPerMonth: number | null;
  /** Team members who are active or invited. Customers are not counted. */
  activeStaff: number | null;
};

export type PlanLimitTable = Record<SubscriptionPlan, PlanLimits>;

const unlimited: PlanLimits = { importJobsPerMonth: null, activeStaff: null };

export const PLAN_LIMITS: PlanLimitTable = {
  STARTER: unlimited,
  BUSINESS: unlimited,
  PROFESSIONAL: unlimited,
  ENTERPRISE: unlimited,
};

const LAPSED = new Set(['PAST_DUE', 'SUSPENDED', 'CANCELLED']);

/**
 * A lapsed plan makes the workspace read-only only once a notice period has
 * ended, and only when that date has been set on the subscription.
 */
export function planIsReadOnly(
  subscription:
    { status: string; readOnlyFrom: Date | null } | null | undefined,
  now = new Date(),
): boolean {
  return Boolean(
    subscription?.readOnlyFrom &&
    LAPSED.has(subscription.status) &&
    subscription.readOnlyFrom <= now,
  );
}

/**
 * Refuses a change that would take a workspace past its plan. `used` includes
 * the change, and is counted only where the plan has a limit.
 */
export async function assertWithinPlan(
  db: Prisma.TransactionClient,
  organisationId: string,
  limit: keyof PlanLimits,
  used: () => number | Promise<number>,
  table: PlanLimitTable = PLAN_LIMITS,
): Promise<void> {
  if (Object.values(table).every((plan) => plan[limit] === null)) return;
  const subscription = await db.subscription.findUnique({
    where: { organisationId },
    select: { plan: true },
  });
  const allowed = subscription ? table[subscription.plan][limit] : null;
  if (allowed === null || (await used()) <= allowed) return;
  throw new ForbiddenException({
    statusCode: 403,
    code: 'plan_limit_reached',
    message:
      limit === 'activeStaff'
        ? `Your plan allows ${allowed} team members.`
        : `Your plan allows ${allowed} new import jobs a month.`,
  });
}

/** Team members who take up a place on the plan. */
export function countStaffSeats(
  db: Prisma.TransactionClient,
  organisationId: string,
) {
  return db.organisationMembership.count({
    where: {
      organisationId,
      role: { not: 'CUSTOMER' },
      status: { in: ['ACTIVE', 'INVITED'] },
    },
  });
}
