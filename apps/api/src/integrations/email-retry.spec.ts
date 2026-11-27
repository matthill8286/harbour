import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailRetryQueue, LATER_RETRY_DELAYS_MS } from './email-retry-queue';
import {
  EmailSendError,
  EmailTransport,
  type OutboundEmail,
} from './email-transport';

const email: OutboundEmail = {
  to: 'anna@example.test',
  subject: 'Hello Anna',
  text: 'https://harbour.example/reset-password/abc123',
  html: '',
};

const make = (env: Record<string, string>) => {
  const transport = new EmailTransport({
    get: (key: string, fallback?: string) => env[key] ?? fallback,
  } as ConfigService);
  transport.retryDelaysMs = [0, 0];
  return transport;
};
const brevo = (extra: Record<string, string> = {}) =>
  make({ EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'k', ...extra });
const resend = () => make({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' });

const answer = (status: number) =>
  ({ ok: status < 300, status }) as unknown as Response;
const networkFailure = (code: string) =>
  Object.assign(new TypeError('fetch failed'), { cause: { code } });
const timeout = () =>
  Object.assign(new Error('timed out'), { name: 'TimeoutError' });

const failure = async (work: Promise<unknown>) => {
  const error = await work.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(EmailSendError);
  return error as EmailSendError;
};

describe('email retries', () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => (fetchMock = jest.spyOn(globalThis, 'fetch')));
  afterEach(() => jest.restoreAllMocks());

  it('gives every call a time limit', async () => {
    fetchMock.mockResolvedValue(answer(201));
    await brevo().send(email);
    await resend().send(email);
    for (const [, init] of fetchMock.mock.calls as Array<
      [string, RequestInit]
    >) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each([
    ['429', () => Promise.resolve(answer(429))],
    ['no DNS', () => Promise.reject(networkFailure('ENOTFOUND'))],
    ['refused', () => Promise.reject(networkFailure('ECONNREFUSED'))],
  ])(
    'tries Brevo again after %s, which cannot have sent it',
    async (_name, first) => {
      fetchMock.mockImplementationOnce(first).mockResolvedValue(answer(201));
      await expect(brevo().send(email)).resolves.toEqual({ provider: 'brevo' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ['a server error', () => Promise.resolve(answer(500))],
    ['a bad request', () => Promise.resolve(answer(400))],
    ['a timeout', () => Promise.reject(timeout())],
    [
      'a dropped connection',
      () => Promise.reject(networkFailure('ECONNRESET')),
    ],
  ])(
    'does not send to Brevo again after %s, which may have sent it',
    async (_name, first) => {
      fetchMock.mockImplementation(first);
      const error = await failure(brevo().send(email));
      expect(error.retry).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('sends Resend the same idempotency key on every try', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(500))
      .mockRejectedValueOnce(networkFailure('ECONNRESET'))
      .mockResolvedValue(answer(200));
    const transport = resend();
    await transport.send(email);
    await transport.send(email);
    const keys = (fetchMock.mock.calls as Array<[string, RequestInit]>).map(
      ([, init]) => (init.headers as Record<string, string>)['Idempotency-Key'],
    );
    expect(new Set(keys.slice(0, 3)).size).toBe(1);
    // Another email, another key.
    expect(keys[3]).not.toBe(keys[0]);
  });

  it('leaves a timeout for later, so the person waiting is not kept longer', async () => {
    fetchMock.mockRejectedValue(timeout());
    const error = await failure(resend().send(email));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.retry).toBeDefined();
  });

  it('counts an email once, however often it is tried, and stays within the limit', async () => {
    fetchMock.mockResolvedValue(answer(429));
    const transport = brevo({ EMAIL_DAILY_LIMIT: '2' });
    const first = await failure(transport.send(email));
    const again = await failure(first.retry!());
    expect(again.retry).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await failure(transport.send(email));
    const calls = fetchMock.mock.calls.length;
    await expect(transport.send(email)).rejects.toThrow('daily email limit');
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    // The two already counted can still be tried.
    fetchMock.mockResolvedValue(answer(201));
    await expect(first.retry!()).resolves.toEqual({ provider: 'brevo' });
  });

  it('logs no address, subject or link in log mode, even where debug is on', async () => {
    const spies = (['log', 'debug', 'warn'] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
    const print = jest.spyOn(process.stdout, 'write');
    await make({}).send(email);
    await make({
      NODE_ENV: 'production',
      EMAIL_PRINT_MESSAGES: 'true',
    }).send(email);
    const written = JSON.stringify([
      ...spies.flatMap((spy) => spy.mock.calls),
      ...print.mock.calls,
    ]);
    expect(written).not.toMatch(/anna|reset-password|Hello/i);
  });

  it('prints the message in local development only when asked', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const print = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    await make({ EMAIL_PRINT_MESSAGES: 'true' }).send(email);
    expect(String(print.mock.calls[0][0])).toContain(email.text);
  });
});

describe('the retry queue', () => {
  const logged = jest.fn();
  const gaveUp = jest.fn();
  const logger = { log: logged, error: gaveUp } as unknown as Logger;
  const retryable = (retry: () => Promise<{ provider: 'brevo' }>) =>
    Object.assign(new EmailSendError('429', true), { retry });
  /** Fails `times` times, then goes. */
  const flaky = (times: number) => {
    let left = times;
    const retry: jest.Mock<Promise<{ provider: 'brevo' }>, []> = jest.fn(() =>
      left-- > 0
        ? Promise.reject(retryable(retry))
        : Promise.resolve({ provider: 'brevo' as const }),
    );
    return retry;
  };
  const wait = (ms: number) => jest.advanceTimersByTimeAsync(ms);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });
  afterEach(() => jest.useRealTimers());

  it('tries later, waiting longer each time, and stops once sent', async () => {
    const queue = new EmailRetryQueue(logger);
    const retry = flaky(2);
    expect(queue.add(retryable(retry), 'a note')).toBe(true);
    await wait(LATER_RETRY_DELAYS_MS[0] - 1);
    expect(retry).toHaveBeenCalledTimes(0);
    await wait(1);
    await wait(LATER_RETRY_DELAYS_MS[1]);
    await wait(LATER_RETRY_DELAYS_MS[2]);
    await wait(24 * 60 * 60 * 1000);
    expect(retry).toHaveBeenCalledTimes(3);
    expect(queue.size).toBe(0);
  });

  it('gives up after the last wait', async () => {
    const queue = new EmailRetryQueue(logger);
    const retry = flaky(100);
    queue.add(retryable(retry), 'a note');
    await wait(24 * 60 * 60 * 1000);
    expect(retry).toHaveBeenCalledTimes(LATER_RETRY_DELAYS_MS.length);
    expect(gaveUp).toHaveBeenCalledTimes(1);
  });

  it('takes nothing that could be delivered twice', () => {
    const queue = new EmailRetryQueue(logger);
    expect(queue.add(new EmailSendError('timeout', false), 'x')).toBe(false);
    expect(queue.add(new Error('anything'), 'x')).toBe(false);
  });

  it('drops a job’s older status when a newer one comes', async () => {
    const queue = new EmailRetryQueue(logger);
    const older = flaky(0);
    const first = queue.supersede('status:1');
    queue.add(retryable(older), 'older', 'status:1', first);
    queue.supersede('status:1');
    expect(queue.size).toBe(0);
    // An older send still under way when the newer one came is not queued.
    expect(queue.add(retryable(older), 'older', 'status:1', first)).toBe(false);
    await wait(24 * 60 * 60 * 1000);
    expect(older).not.toHaveBeenCalled();
  });

  it('cancels what is waiting when the app stops', async () => {
    const queue = new EmailRetryQueue(logger);
    const retry = flaky(0);
    queue.add(retryable(retry), 'a');
    expect(queue.stop()).toBe(1);
    expect(queue.add(retryable(retry), 'b')).toBe(false);
    await wait(24 * 60 * 60 * 1000);
    expect(retry).not.toHaveBeenCalled();
  });
});
