import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { AppLogger } from './app-logger';
import { reportFatalErrors } from './process-errors';
import { describeError, redact } from './redact';

const token = 'Zk3_9aQvXb1LmN0pRsT4uVwXyZ012345678abcDEF-g';

describe('redact', () => {
  it.each([
    [`open https://harbour.example/invite/short1 now`, 'short1'],
    [`https://harbour.example/reset-password/${token}`, token],
    [`https://harbour.example/signup/confirm/abc123`, 'abc123'],
    [`GET /api/auth/password/reset/abc123`, 'abc123'],
    [`GET /api/auth/invites/abc123/accept`, 'abc123'],
    [`/map?token=pk123&z=1`, 'pk123'],
    [`Authorization: Bearer abcdefgh12345678`, 'abcdefgh12345678'],
    [`postgresql://vip:pa55word@db:5432/x`, 'pa55word'],
    [`to=anna.k+x@example.co.uk failed`, 'anna.k'],
    [`ident 356307042441013 refused`, '356307042441013'],
    [`key ${token} used`, token],
  ])('removes the secret or personal part of %s', (text, secret) => {
    expect(redact(text)).not.toContain(secret);
  });

  it('keeps what is needed to read a log', () => {
    for (const text of [
      '/api/auth/invites/:token/accept',
      'Tracker cm4x9q2ab0001abcdefghijkl shares its IMEI',
      'PrismaClientUnknownRequestError',
      'Deleted 120000 GPS points from closed jobs',
    ]) {
      expect(redact(text)).toBe(text);
    }
  });

  it('drops the query that a Prisma message quotes', () => {
    const error = new Error(
      'Invalid `prisma.customer.create()` invocation:\n{ lastName: "Example" }',
    );
    expect(redact(error.message)).not.toContain('Example');
    expect(redact(describeError(error).message!)).not.toContain('Example');
  });
});

describe('the logger', () => {
  type Line = { level: string; msg: string; stack?: string[] };
  const lines: Line[] = [];
  const make = (env: NodeJS.ProcessEnv) =>
    new AppLogger((_level, line) => lines.push(JSON.parse(line) as Line), env);
  beforeEach(() => (lines.length = 0));

  it('writes one JSON line with the name, and redacts an error it is given', () => {
    const logger = make({});
    logger.error(
      'Failed to send password reset email',
      new Error('rejected anna@example.test'),
      'PasswordResetService',
    );
    expect(lines[0]).toMatchObject({
      level: 'error',
      context: 'PasswordResetService',
      msg: 'Failed to send password reset email',
      error: { name: 'Error', message: 'rejected [email]' },
    });
  });

  it('redacts a stack passed as text', () => {
    const stack = new Error('anna@example.test').stack;
    make({}).error('Could not stop', stack, 'App');
    expect(lines[0].stack?.length).toBeGreaterThan(0);
    expect(JSON.stringify(lines)).not.toContain('anna@');
  });

  it('writes no debug lines in production', () => {
    make({ NODE_ENV: 'production' }).debug('quiet', 'App');
    make({}).debug('loud', 'App');
    expect(lines.map((line) => line.msg)).toEqual(['loud']);
  });

  it('logs and reports an uncaught error, then stops', () => {
    const target = Object.assign(new EventEmitter(), { exit: jest.fn() });
    const report = jest.fn();
    Logger.overrideLogger(make({}));
    reportFatalErrors({ report }, target as unknown as NodeJS.Process);
    target.emit('unhandledRejection', new Error('boom anna@example.test'));
    Logger.overrideLogger(false);
    expect(target.exit).toHaveBeenCalledWith(1);
    expect(report).toHaveBeenCalled();
    expect(JSON.stringify([lines, report.mock.calls])).not.toContain('anna@');
    expect(lines[0].level).toBe('fatal');
  });
});
