/**
 * The emails to a workspace's Admins when the operator closes it, before its
 * deletion and when the closure is cancelled, against a real PostgreSQL
 * database. Skipped unless TEST_DATABASE_URL names a scratch database that
 * already has the schema:
 *
 *   DATABASE_URL=<scratch url> pnpm run db:deploy
 *   TEST_DATABASE_URL=<scratch url> pnpm exec jest db.spec
 */
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type {
  EmailTransport,
  OutboundEmail,
} from '../integrations/email-transport';
import {
  NotificationsService,
  WORKSPACE_DAILY_NOTIFICATIONS,
} from '../integrations/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimiter } from '../rate-limit/rate-limiter';
import { ClosureEmailService } from './closure-email.service';
import { runOperatorCommand } from './operator-command';

const url = process.env.TEST_DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

describeWithDatabase('emails about a workspace closure', () => {
  let prisma: PrismaService;
  let operatorEmail: string;
  let limiter: RateLimiter;
  let service: ClosureEmailService;
  let sent: { to: string; subject: string }[];
  let failFor: string | undefined;
  const env = { ...process.env };

  beforeAll(async () => {
    delete process.env.WORKSPACE_DELETION_NOTICE_DAYS;
    delete process.env.WORKSPACE_DELETION_REMINDER_DAYS;
    prisma = new PrismaService({ datasources: { db: { url } } });
    const operator = await prisma.user.create({
      data: {
        email: `operator-${randomUUID()}@example.test`,
        name: 'Operator',
        passwordHash: 'a-hash',
        twoFactorEnabled: true,
        platformAdmin: { create: {} },
      },
    });
    operatorEmail = operator.email;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    process.env = env;
  });

  beforeEach(() => {
    sent = [];
    failFor = undefined;
    limiter = new RateLimiter();
    // Like the real transport, it asks before it sends.
    const transport = {
      deliver: async (email: OutboundEmail) => {
        if (email.stillAllowed && !(await email.stillAllowed())) {
          throw new Error('This workspace cannot send email now');
        }
        if (email.to === failFor) throw new Error('The provider is down');
        sent.push({ to: email.to, subject: email.subject });
        return { provider: 'log' as const };
      },
    };
    const notifications = new NotificationsService(
      prisma,
      { get: (_key: string, fallback?: string) => fallback } as ConfigService,
      transport as unknown as EmailTransport,
      limiter,
    );
    service = new ClosureEmailService(prisma, notifications);
  });

  const date = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

  /** Two active Admins, plus a Staff member and a disabled Admin. */
  async function workspace() {
    const slug = `closure-email-${randomUUID()}`;
    const organisation = await prisma.organisation.create({
      data: {
        name: slug,
        slug,
        settings: { create: { brandName: 'Demo Imports' } },
      },
    });
    const member = async (
      role: 'ADMIN' | 'STAFF',
      status: 'ACTIVE' | 'DISABLED' = 'ACTIVE',
    ) => {
      const user = await prisma.user.create({
        data: {
          email: `${randomUUID()}@example.test`,
          name: `${role} person`,
          passwordHash: 'a-password-hash',
        },
      });
      await prisma.organisationMembership.create({
        data: {
          organisationId: organisation.id,
          userId: user.id,
          role,
          status,
        },
      });
      return user.email;
    };
    const admins = [await member('ADMIN'), await member('ADMIN')];
    const others = [await member('STAFF'), await member('ADMIN', 'DISABLED')];
    return { organisation, slug, admins, others };
  }

  const close = (slug: string, contractEnd: string) =>
    runOperatorCommand(prisma, [
      'close',
      slug,
      '--by',
      operatorEmail,
      '--contract-end',
      contractEnd,
      '--reason',
      'The contract ends',
    ]);
  const cancel = (slug: string) =>
    runOperatorCommand(prisma, [
      'cancel-close',
      slug,
      '--by',
      operatorEmail,
      '--reason',
      'The contract was renewed',
    ]);
  /** What this workspace's people were sent, ignoring other tests' rows. */
  const to = (addresses: string[]) =>
    sent.filter((email) => addresses.includes(email.to));

  it('emails each active Admin once when closed, and once before the deletion', async () => {
    const { slug, admins, others } = await workspace();
    const output = await close(slug, date(10));
    expect(output).toContain('Its active Admins will be emailed');
    expect(output).toContain('reminded on');

    await service.sendDue();
    expect(
      to(admins)
        .map((email) => email.to)
        .sort(),
    ).toEqual([...admins].sort());
    expect(to(admins)[0].subject).toMatch(
      /^Demo Imports will be deleted after/,
    );
    expect(to(others)).toEqual([]);

    // Run again, as the next run or a second api would: nothing repeats.
    sent = [];
    await service.sendDue();
    expect(to(admins)).toEqual([]);

    // The reminder goes 7 days before the deletion, 30 days after the end.
    const remindAt = (
      await prisma.closureEmail.findFirstOrThrow({
        where: { organisation: { slug }, kind: 'REMINDER' },
      })
    ).dueAt;
    const deleteAfter = (
      await prisma.workspaceClosure.findFirstOrThrow({
        where: { organisation: { slug } },
      })
    ).deleteAfter;
    expect(deleteAfter.getTime() - remindAt.getTime()).toBe(7 * DAY);
    await service.sendDue(new Date(remindAt.getTime() - MINUTE));
    expect(to(admins)).toEqual([]);
    await service.sendDue(new Date(remindAt.getTime() + MINUTE));
    expect(to(admins)).toHaveLength(2);
    expect(to(admins)[0].subject).toMatch(/^Reminder: /);
    sent = [];
    await service.sendDue(new Date(remindAt.getTime() + DAY));
    expect(to(admins)).toEqual([]);
  });

  it('sends no reminder when the deletion is already that close', async () => {
    const { organisation, slug } = await workspace();
    const output = await close(slug, date(-40));
    expect(output).not.toContain('reminded on');
    const rows = await prisma.closureEmail.findMany({
      where: { organisationId: organisation.id },
    });
    expect(rows.map((row) => row.kind)).toEqual(['SCHEDULED']);
  });

  it('sends nothing at all when cancelled before any email went', async () => {
    const { organisation, slug, admins } = await workspace();
    await close(slug, date(10));
    const output = await cancel(slug);
    expect(output).toContain('had not been emailed');
    await service.sendDue(new Date(Date.now() + 40 * DAY));
    expect(to(admins)).toEqual([]);
    expect(
      await prisma.closureEmail.count({
        where: { organisationId: organisation.id },
      }),
    ).toBe(0);
  });

  it('tells the Admins once that a closure is cancelled, and sends no reminder', async () => {
    const { slug, admins } = await workspace();
    await close(slug, date(10));
    await service.sendDue();
    sent = [];

    const output = await cancel(slug);
    expect(output).toContain('will be emailed that it is cancelled');
    await service.sendDue();
    expect(to(admins)).toHaveLength(2);
    expect(to(admins)[0].subject).toBe(
      'Demo Imports will no longer be deleted',
    );

    sent = [];
    await service.sendDue();
    await service.sendDue(new Date(Date.now() + 40 * DAY));
    expect(to(admins)).toEqual([]);
  });

  it('starts afresh when a cancelled workspace is closed again', async () => {
    const { organisation, slug, admins } = await workspace();
    await close(slug, date(10));
    await service.sendDue();
    await cancel(slug);
    await close(slug, date(20));
    sent = [];
    await service.sendDue();
    expect(to(admins).map((email) => email.subject)).toEqual([
      expect.stringMatching(/will be deleted after/),
      expect.stringMatching(/will be deleted after/),
    ]);
    const kinds = await prisma.closureEmail.findMany({
      where: { organisationId: organisation.id },
      orderBy: { dueAt: 'asc' },
    });
    expect(kinds.map((row) => row.kind)).toEqual(['SCHEDULED', 'REMINDER']);
  });

  it('waits while the workspace is suspended', async () => {
    const { organisation, slug, admins } = await workspace();
    await close(slug, date(10));
    await prisma.organisation.update({
      where: { id: organisation.id },
      data: { status: 'SUSPENDED' },
    });
    await service.sendDue();
    expect(to(admins)).toEqual([]);

    await prisma.organisation.update({
      where: { id: organisation.id },
      data: { status: 'ACTIVE' },
    });
    await service.sendDue();
    expect(to(admins)).toHaveLength(2);
  });

  it('tries a failed email again later, without repeating it to anyone it reached', async () => {
    const { slug, admins } = await workspace();
    await close(slug, date(10));
    failFor = admins[1];
    const first = await service.sendDue();
    expect(first.failed).toBeGreaterThanOrEqual(1);
    expect(to(admins).map((email) => email.to)).toEqual([admins[0]]);

    failFor = undefined;
    sent = [];
    await service.sendDue();
    expect(to(admins).map((email) => email.to)).toEqual([admins[1]]);
  });

  it('keeps to the daily email limit, and sends once there is room', async () => {
    const { organisation, slug, admins } = await workspace();
    await close(slug, date(10));
    for (let index = 0; index < WORKSPACE_DAILY_NOTIFICATIONS; index += 1) {
      limiter.take(
        `workspace-notifications:${organisation.id}`,
        WORKSPACE_DAILY_NOTIFICATIONS,
        DAY,
      );
    }
    await service.sendDue();
    expect(to(admins)).toEqual([]);

    // A new limiter stands for the next day's window.
    (
      service as unknown as { notifications: { limiter: RateLimiter } }
    ).notifications.limiter = new RateLimiter();
    await service.sendDue();
    expect(to(admins)).toHaveLength(2);
  });
});
