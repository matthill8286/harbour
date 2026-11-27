import { rateLimitAddress } from './client-ip';
import { RATE_LIMITS } from './policies';
import { MAX_KEYS, RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  const { limit, windowMs } = RATE_LIMITS.passwordAccount;
  const use = (limiter: RateLimiter, key: string, now: number) => {
    for (let i = 0; i < limit; i += 1) {
      limiter.consume('passwordAccount', key, now);
    }
  };

  it('refuses one attempt too many, until the window ends', () => {
    const limiter = new RateLimiter();
    use(limiter, 'a', 0);
    expect(() => limiter.consume('passwordAccount', 'a', 1000)).toThrow(
      'Try again in 15 minutes.',
    );
    expect(() =>
      limiter.consume('passwordAccount', 'a', windowMs),
    ).not.toThrow();
  });

  it('counts each key and each policy on its own', () => {
    const limiter = new RateLimiter();
    use(limiter, 'a', 0);
    expect(() => limiter.consume('passwordAccount', 'b', 0)).not.toThrow();
    expect(() => limiter.consume('loginIp', 'a', 0)).not.toThrow();
  });

  it('starts again after a reset', () => {
    const limiter = new RateLimiter();
    use(limiter, 'a', 0);
    limiter.reset('passwordAccount', 'a');
    expect(() => limiter.consume('passwordAccount', 'a', 0)).not.toThrow();
  });

  it('keeps a bounded number of keys', () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < MAX_KEYS + 10; i += 1) limiter.take(`${i}`, 1, 1000, 0);
    expect(
      (limiter as unknown as { windows: Map<string, unknown> }).windows.size,
    ).toBeLessThanOrEqual(MAX_KEYS);
  });
});

describe('rateLimitAddress', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    ['2001:0db8:0001:0002::1', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    [undefined, 'unknown'],
  ])('counts %s as %s', (ip, expected) => {
    expect(rateLimitAddress(ip)).toBe(expected);
  });
});
