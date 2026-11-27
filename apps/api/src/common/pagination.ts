/**
 * Cursor pages for the long lists. A cursor holds the sort values of the last
 * row sent, so the next page starts after it even when rows are added or
 * removed in between. Every sort ends with the id, so no two rows tie. A cursor
 * only ever narrows a query that is already limited to one workspace.
 */
import { BadRequestException } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const MAX_PAGE_SIZE = 100;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** The query parameters every paged list takes. */
export class PageQuery {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trimmed)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}

export function encodeCursor(values: string[]): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

const badCursor = () =>
  new BadRequestException('That page link is not valid. Reload the list.');

/** The `length` sort values a cursor holds. */
export function decodeCursor(cursor: string, length: number): string[] {
  let values: unknown;
  try {
    values = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw badCursor();
  }
  if (
    !Array.isArray(values) ||
    values.length !== length ||
    !values.every((value) => typeof value === 'string')
  ) {
    throw badCursor();
  }
  return values;
}

/** Rows after the cursor, for a list sorted newest first, then by id. */
export function afterNewest(cursor: string) {
  const [at, id] = decodeCursor(cursor, 2);
  const createdAt = new Date(at);
  if (Number.isNaN(createdAt.getTime())) throw badCursor();
  return {
    // The first condition lets an index on createdAt skip the earlier pages.
    createdAt: { lte: createdAt },
    OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
  };
}

export const newestCursor = (row: { createdAt: Date; id: string }) =>
  encodeCursor([row.createdAt.toISOString(), row.id]);

/** Splits `limit + 1` fetched rows into the page and the cursor for the next. */
export function toPage<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: NoInfer<T>) => string,
) {
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: rows.length > limit ? cursorOf(items[items.length - 1]) : null,
  };
}
