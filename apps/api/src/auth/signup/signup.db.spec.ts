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
