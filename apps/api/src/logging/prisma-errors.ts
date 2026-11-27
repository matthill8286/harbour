import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type Problem = { status: HttpStatus; message: string };

/**
 * What a caller is told when the database refuses something. The messages name
 * no table, column or value.
 */
const KNOWN: Record<string, Problem> = {
  // A value that is too long, or a number that does not fit.
  P2000: {
    status: HttpStatus.BAD_REQUEST,
    message: 'One of the values is too long.',
  },
  P2020: {
    status: HttpStatus.BAD_REQUEST,
    message: 'One of the numbers is out of range.',
  },
  P2002: {
    status: HttpStatus.CONFLICT,
    message: 'That already exists.',
  },
  P2003: {
    status: HttpStatus.CONFLICT,
    message:
      'This is linked to another record, or refers to one that does not exist.',
  },
  P2014: {
    status: HttpStatus.CONFLICT,
    message: 'Another record still depends on this one.',
  },
  P2025: {
    status: HttpStatus.NOT_FOUND,
    message: 'That record was not found.',
  },
  P2034: {
    status: HttpStatus.CONFLICT,
    message: 'Someone else changed this at the same time. Please try again.',
  },
  // No database connection was free in time.
  P2024: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Harbour is busy. Please try again.',
  },
};

/**
 * Undefined for anything else, which stays a 500: a query Prisma rejects as
 * invalid, for example, is a fault in Harbour.
 */
export function prismaProblem(error: unknown): Problem | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return KNOWN[error.code];
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'Harbour cannot reach its database. Please try again.',
    };
  }
  return undefined;
}
