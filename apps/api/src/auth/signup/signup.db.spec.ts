/**
 * Sign-up against a real PostgreSQL database. Skipped unless TEST_DATABASE_URL
 * names a scratch database that already has the schema (see
 * prisma/locked-writes.db.spec.ts).
 */
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { AuditService } from '../../audit/audit.service';
import type { EmailTransport } from '../../integrations/email-transport';
import { PrismaService } from '../../prisma/prisma.service';
import type { Licence } from '../../licensing/licence';
import { LicensingService } from '../../licensing/licensing.service';
import { RateLimiter } from '../../rate-limit/rate-limiter';
import { SignupService } from './signup.service';

const url = process.env.TEST_DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;

describeWithDatabase('sign-up against PostgreSQL', () => {
  let prisma: PrismaService;
  let signups: SignupService;
  const mail: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    signups = new SignupService(
      prisma,
      new JwtService({ secret: 'test-jwt-secret' }),
      new AuditService(prisma),
      {
        deliver: async ({ text }: { text: string }) => {
          mail.push(text);
          return Promise.resolve({ provider: 'brevo' as const });
        },
      } as unknown as EmailTransport,
      { get: (_key: string, fallback?: string) => fallback } as never,
      new RateLimiter(),
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function linkFor(email: string) {
    await signups.request({ organisationName: 'Race Ltd', name: 'R', email });
    return /signup\/confirm\/([A-Za-z0-9_-]+)/.exec(mail[mail.length - 1])![1];
  }

  const workspacesOf = (email: string) =>
    prisma.organisationMembership.count({ where: { user: { email } } });

  it('makes one workspace when two links are used at once', async () => {
    for (let round = 0; round < 5; round += 1) {
      const email = `${randomUUID()}@example.test`;
      const links = [await linkFor(email), await linkFor(email)];
      const results = await Promise.allSettled(
        links.map((token) => signups.confirm(token, 'a-long-password')),
      );
      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { status: 400 },
      });
      await expect(workspacesOf(email)).resolves.toBe(1);
    }
  });

  it('uses one link once when it is sent twice at once', async () => {
    const email = `${randomUUID()}@example.test`;
    const token = await linkFor(email);
    const results = await Promise.allSettled(
      [1, 2].map(() => signups.confirm(token, 'a-long-password')),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(workspacesOf(email)).resolves.toBe(1);
  });
});

describeWithDatabase('sign-up where licences are checked', () => {
  let prisma: PrismaService;
  const mail: string[] = [];
  const licences = new Map<string, Licence>();
  let bindFails = false;

  /** The account service's licences, held in memory. */
  const licensing = new LicensingService({
    get: (key: string) =>
      ({ ACCOUNT_INTERNAL_URL: 'http://account', ACCOUNT_TOKEN: 'token' })[key],
  } as never);
  licensing.fetcher = (url, init) => {
    const answer = (value: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(value), { status }));
    const bind = /licences\/([^/]+)\/tenant$/.exec(url);
    if (bind) {
      if (bindFails) return Promise.reject(new Error('connection refused'));
      const licence = licences.get(bind[1]);
      const { tenant } = JSON.parse(init.body as string) as { tenant: string };
      if (!licence || (licence.tenant && licence.tenant !== tenant)) {
        return answer({}, 409);
      }
      licence.tenant = tenant;
      return answer({ licence });
    }
    const licence = licences.get(url.split('/').pop() ?? '');
    return licence ? answer({ licence }) : answer({}, 404);
  };

  function issue(owner: string, over: Partial<Licence> = {}) {
    const licence: Licence = {
      id: randomUUID(),
      plan: 'desk',
      status: 'active',
      seats: null,
      limits: {},
      endsAt: null,
      graceEndsAt: null,
      readOnlyEndsAt: null,
      tenant: null,
      owners: [owner],
      ...over,
    };
    licences.set(licence.id, licence);
    return licence;
  }

  let signups: SignupService;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    signups = new SignupService(
      prisma,
      new JwtService({ secret: 'test-jwt-secret' }),
      new AuditService(prisma),
      {
        deliver: async ({ text }: { text: string }) => {
          mail.push(text);
          return Promise.resolve({ provider: 'brevo' as const });
        },
      } as unknown as EmailTransport,
      { get: (_key: string, fallback?: string) => fallback } as never,
      new RateLimiter(),
      licensing,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const request = (email: string, licenceId?: string) =>
    signups.request({
      organisationName: 'Licensed Imports',
      name: 'Owner',
      email,
      licenceId,
    });
  const lastLink = () =>
    /signup\/confirm\/([A-Za-z0-9_-]+)/.exec(mail[mail.length - 1])![1];
  const workspacesOf = (email: string) =>
    prisma.organisationMembership.findMany({
      where: { user: { email } },
      include: { organisation: { include: { subscription: true } } },
    });

  it('refuses a stranger, and anyone a licence does not name', async () => {
    const stranger = `${randomUUID()}@example.test`;
    const sent = mail.length;
    await expect(request(stranger)).rejects.toMatchObject({
      response: { code: 'licence_not_found' },
    });
    await expect(request(stranger, randomUUID())).rejects.toMatchObject({
      response: { code: 'licence_not_found' },
    });
    const other = issue(`${randomUUID()}@example.test`);
    await expect(request(stranger, other.id)).rejects.toMatchObject({
      response: { code: 'licence_not_yours' },
    });
    // Each address may ask only a few times an hour, so this one is new.
    const held = `${randomUUID()}@example.test`;
    const stopped = issue(held, { status: 'suspended' });
    await expect(request(held, stopped.id)).rejects.toMatchObject({
      response: { code: 'licence_not_active' },
    });
    expect(mail).toHaveLength(sent);
    await expect(
      prisma.signupRequest.count({ where: { email: stranger } }),
    ).resolves.toBe(0);
  });

  it("sets the workspace up under the licence, with the licence's id, and binds it", async () => {
    const email = `${randomUUID()}@example.test`;
    const licence = issue(email);
    await request(email.toUpperCase(), licence.id);
    const result = await signups.confirm(lastLink(), 'a-long-password');
    expect(result.user.organisationId).toBe(licence.id);
    expect(licence.tenant).toBe(licence.id);
    const [membership] = await workspacesOf(email);
    expect(membership.organisation.subscription?.status).toBe('ACTIVE');
    // The licence is used now, so it cannot start another workspace.
    await expect(request(email, licence.id)).rejects.toMatchObject({
      response: { code: 'licence_used' },
    });
  });

  it('makes no workspace when the licence stopped after the email was sent', async () => {
    const email = `${randomUUID()}@example.test`;
    const licence = issue(email);
    await request(email, licence.id);
    licence.status = 'suspended';
    await expect(
      signups.confirm(lastLink(), 'a-long-password'),
    ).rejects.toMatchObject({ response: { code: 'licence_not_active' } });
    await expect(workspacesOf(email)).resolves.toHaveLength(0);
  });

  it('makes no workspace when the licence cannot be bound, and the same link then finishes it', async () => {
    const email = `${randomUUID()}@example.test`;
    const licence = issue(email);
    await request(email, licence.id);
    const link = lastLink();
    bindFails = true;
    try {
      await expect(
        signups.confirm(link, 'a-long-password'),
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      bindFails = false;
    }
    await expect(workspacesOf(email)).resolves.toHaveLength(0);
    expect(licence.tenant).toBeNull();
    const result = await signups.confirm(link, 'a-long-password');
    expect(result.user.organisationId).toBe(licence.id);
  });
});
