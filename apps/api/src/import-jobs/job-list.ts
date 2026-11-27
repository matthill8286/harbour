import type { Prisma } from '@prisma/client';

const contains = (search: string) =>
  ({ contains: search, mode: 'insensitive' }) as const;

/** Reference, customer name, make, model or plate. */
export function jobSearch(search: string): Prisma.ImportJobWhereInput {
  const match = contains(search);
  return {
    OR: [
      { reference: match },
      { customer: { firstName: match } },
      { customer: { lastName: match } },
      { vehicle: { make: match } },
      { vehicle: { model: match } },
      { vehicle: { ukRegistration: match } },
    ],
  };
}

/** A job without a route follows the default one. */
export function onRoute(
  routeId: string,
  isDefault: boolean,
): Prisma.ImportJobWhereInput {
  return isDefault ? { OR: [{ routeId }, { routeId: null }] } : { routeId };
}
