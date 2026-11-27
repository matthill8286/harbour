import type { Prisma } from '@prisma/client';
import { decodeCursor, encodeCursor } from '../common/pagination';

/**
 * Every word must appear in the name, email or phone, so a full name such as
 * "Anna Brown" finds the customer.
 */
export function customerSearch(search: string): Prisma.CustomerWhereInput[] {
  return search
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const match = { contains: word, mode: 'insensitive' } as const;
      return {
        OR: [
          { firstName: match },
          { lastName: match },
          { email: match },
          { phone: match },
        ],
      };
    });
}

/** Customers after the cursor, in last name, first name, id order. */
export function afterName(cursor: string): Prisma.CustomerWhereInput {
  const [lastName, firstName, id] = decodeCursor(cursor, 3);
  return {
    lastName: { gte: lastName },
    OR: [
      { lastName: { gt: lastName } },
      { lastName, firstName: { gt: firstName } },
      { lastName, firstName, id: { gt: id } },
    ],
  };
}

export const nameCursor = (row: {
  lastName: string;
  firstName: string;
  id: string;
}) => encodeCursor([row.lastName, row.firstName, row.id]);
