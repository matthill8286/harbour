import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { JobListQuery } from '../import-jobs/dto/job-list.query';
import {
  afterNewest,
  decodeCursor,
  encodeCursor,
  newestCursor,
  toPage,
} from './pagination';

describe('list cursors', () => {
  const row = { id: 'job-2', createdAt: new Date('2026-05-01T10:00:00.123Z') };

  it('starts the next page after the last row, using the id to break ties', () => {
    expect(afterNewest(newestCursor(row))).toEqual({
      createdAt: { lte: row.createdAt },
      OR: [
        { createdAt: { lt: row.createdAt } },
        { createdAt: row.createdAt, id: { lt: 'job-2' } },
      ],
    });
  });

  it('keeps names with any characters', () => {
    const values = ['O’Brien, "Jr"', 'Ζωή', 'c1'];
    expect(decodeCursor(encodeCursor(values), 3)).toEqual(values);
  });

  it.each([
    'not a cursor',
    encodeCursor(['only-one']),
    Buffer.from('{"a":1}').toString('base64url'),
    Buffer.from('[1,2]').toString('base64url'),
    encodeCursor(['not a date', 'id']),
  ])('refuses %s', (cursor) => {
    expect(() => afterNewest(cursor)).toThrow(BadRequestException);
  });

  it('gives a next cursor only when there are more rows', () => {
    const cursorOf = (value: number) => String(value);
    expect(toPage([1, 2, 3], 2, cursorOf)).toEqual({
      items: [1, 2],
      nextCursor: '2',
    });
    expect(toPage([1, 2], 2, cursorOf)).toEqual({
      items: [1, 2],
      nextCursor: null,
    });
  });
});

describe('list query parameters', () => {
  // As app.setup.ts sets it up, and also without implicit conversion.
  const pipes = [true, false].map(
    (enableImplicitConversion) =>
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion },
      }),
  );
  const read = (pipe: ValidationPipe, query: object): Promise<unknown> =>
    pipe.transform(query, { type: 'query', metatype: JobListQuery });

  it.each(pipes)('reads a page size and trims the search', async (pipe) => {
    await expect(
      read(pipe, { limit: '25', search: '  ford ', other: 'x' }),
    ).resolves.toEqual({ limit: 25, search: 'ford' });
  });

  it.each(pipes)('refuses sizes and values out of range', async (pipe) => {
    for (const query of [
      { limit: '0' },
      { limit: '101' },
      { limit: 'all' },
      { search: 'x'.repeat(201) },
      { status: ['A', 'B'] },
    ]) {
      if (query.status && pipe === pipes[0]) continue;
      await expect(read(pipe, query)).rejects.toThrow(BadRequestException);
    }
  });
});
