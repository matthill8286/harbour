import type { ConfigService } from '@nestjs/config';
import {
  FRESH_MISSING_MS,
  FRESH_MS,
  LicensingService,
  STALE_MS,
} from './licensing.service';

const ORG = 'cmorg0000000000000000001';
const LICENCE = '2f1c9a34-5b6d-4e7f-8a90-b1c2d3e4f506';

const config = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const body = (status: string, over: Record<string, unknown> = {}) => ({
  licence: {
    id: LICENCE,
    plan: 'desk',
    status,
    seats: 3,
    limits: { importJobsPerMonth: 20 },
    endsAt: null,
    graceEndsAt: null,
    readOnlyEndsAt: null,
    tenant: ORG,
    owners: ['owner@imports.test'],
    ...over,
  },
});

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** A stand-in account service whose next answer the test sets, and a clock the test moves. */
function setup() {
  const service = new LicensingService(
    config({
      ACCOUNT_INTERNAL_URL: 'http://account:5090/',
      ACCOUNT_TOKEN: 'harbour-token',
    }),
  );
  let now = Date.parse('2027-01-01T00:00:00Z');
  const calls: { url: string; init: RequestInit }[] = [];
  let answer: () => Response = () => json(body('active'));
  service.now = () => now;
  service.fetcher = (url, init) => {
    calls.push({ url, init });
    try {
      return Promise.resolve(answer());
    } catch (error) {
      return Promise.reject(error as Error);
    }
  };
  return {
    service,
    calls,
    answer: (next: () => Response) => {
      answer = next;
    },
    down: () => {
      answer = () => {
        throw new Error('connection refused');
      };
    },
    pass: (ms: number) => {
      now += ms;
    },
  };
}

describe('the licensing service', () => {
  it('does not check licences when the account service is not configured', async () => {
    const off = new LicensingService(config({}));
    expect(off.enabled).toBe(false);
    expect(await off.limit(ORG, 'activeStaff')).toBeNull();
  });

  it('refuses to start with only one of the two settings', () => {
    expect(
      () => new LicensingService(config({ ACCOUNT_TOKEN: 'harbour-token' })),
    ).toThrow(/both/);
  });

  it("asks with Harbour's token and keeps the answer for five minutes", async () => {
    const s = setup();
    expect((await s.service.forWorkspace(ORG))?.status).toBe('active');
    expect(s.calls[0].url).toBe(
      `http://account:5090/internal/licences?tenant=${ORG}`,
    );
    expect(
      (s.calls[0].init.headers as Record<string, string>).authorization,
    ).toBe('Bearer harbour-token');
    s.answer(() => json(body('suspended')));
    s.pass(FRESH_MS - 1);
    expect((await s.service.forWorkspace(ORG))?.status).toBe('active');
    expect(s.calls).toHaveLength(1);
    s.pass(1);
    expect((await s.service.forWorkspace(ORG))?.status).toBe('suspended');
  });

  it("believes 'no licence' for a minute only", async () => {
    const s = setup();
    s.answer(() => json({ code: 'no_licence' }, 404));
    expect(await s.service.forWorkspace(ORG)).toBeNull();
    s.answer(() => json(body('active')));
    s.pass(FRESH_MISSING_MS - 1);
    expect(await s.service.forWorkspace(ORG)).toBeNull();
    s.pass(1);
    expect((await s.service.forWorkspace(ORG))?.status).toBe('active');
  });

  it('uses the last answer for a day while the account service is down, then refuses', async () => {
    const s = setup();
    await s.service.forWorkspace(ORG);
    s.down();
    s.pass(STALE_MS - 1);
    expect((await s.service.forWorkspace(ORG))?.status).toBe('active');
    s.pass(1);
    await expect(s.service.forWorkspace(ORG)).rejects.toMatchObject({
      response: { code: 'licence_unavailable' },
    });
  });

  it("treats a server error as an outage, not as 'no licence'", async () => {
    const s = setup();
    await s.service.forWorkspace(ORG);
    s.answer(() => json({}, 500));
    s.pass(FRESH_MS);
    expect((await s.service.forWorkspace(ORG))?.status).toBe('active');
  });

  it('refuses a workspace it has never had an answer for while the account service is down', async () => {
    const s = setup();
    s.down();
    await expect(s.service.forWorkspace(ORG)).rejects.toMatchObject({
      status: 503,
    });
  });

  it("reads the licence's limits", async () => {
    const s = setup();
    expect(await s.service.limit(ORG, 'activeStaff')).toBe(3);
    expect(await s.service.limit(ORG, 'importJobsPerMonth')).toBe(20);
  });

  it('lets the person a licence names set a workspace up, and says why others may not', async () => {
    const s = setup();
    s.answer(() => json(body('active', { tenant: null })));
    expect(
      (await s.service.requireSetUp(LICENCE, 'Owner@Imports.test')).id,
    ).toBe(LICENCE);
    await expect(
      s.service.requireSetUp(LICENCE, 'thief@else.test'),
    ).rejects.toMatchObject({ response: { code: 'licence_not_yours' } });
    await expect(
      s.service.requireSetUp(undefined, 'owner@imports.test'),
    ).rejects.toMatchObject({ response: { code: 'licence_not_found' } });
    s.answer(() => json(body('active')));
    await expect(
      s.service.requireSetUp(LICENCE, 'owner@imports.test'),
    ).rejects.toMatchObject({ response: { code: 'licence_used' } });
  });

  it('binds a workspace, remembers the licence, and reports a used licence as a conflict', async () => {
    const s = setup();
    expect((await s.service.bind(LICENCE, ORG)).tenant).toBe(ORG);
    expect(s.calls[0].url).toBe(
      `http://account:5090/internal/licences/${LICENCE}/tenant`,
    );
    expect(s.calls[0].init.body).toBe(JSON.stringify({ tenant: ORG }));
    await s.service.forWorkspace(ORG);
    expect(s.calls).toHaveLength(1);
    s.answer(() => json({ code: 'licence_bound' }, 409));
    await expect(s.service.bind(LICENCE, 'another')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('releases a deleted workspace, and forgets its licence', async () => {
    const s = setup();
    await s.service.forWorkspace(ORG);
    s.answer(() =>
      json(
        body('expired', { tenant: null, releasedAt: '2027-01-01T00:00:00Z' }),
      ),
    );
    expect(await s.service.release(LICENCE, ORG)).toMatchObject({
      status: 'expired',
      tenant: null,
    });
    expect(s.calls[1].url).toBe(
      `http://account:5090/internal/licences/${LICENCE}/release`,
    );
    expect(s.calls[1].init.method).toBe('POST');
    expect(s.calls[1].init.body).toBe(JSON.stringify({ tenant: ORG }));
    // The cached licence is gone, so the next check asks again.
    s.answer(() => json({ code: 'no_licence' }, 404));
    expect(await s.service.forWorkspace(ORG)).toBeNull();
    expect(s.calls).toHaveLength(3);
  });

  it('says why a release failed', async () => {
    const s = setup();
    s.answer(() => json({ code: 'tenant_not_bound' }, 409));
    await expect(s.service.release(LICENCE, ORG)).rejects.toThrow(
      'The account service answered 409 (tenant_not_bound).',
    );
    s.down();
    await expect(s.service.release(LICENCE, ORG)).rejects.toThrow(
      'The account service could not be reached: connection refused',
    );
  });
});
