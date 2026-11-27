/**
 * Invites, team changes, password reset, tracker assignment and stage saving
 * against a real PostgreSQL database. Skipped unless TEST_DATABASE_URL names a
 * scratch database that already has the schema:
 *
 *   DATABASE_URL=<scratch url> pnpm exec prisma db push --skip-generate
 *   TEST_DATABASE_URL=<scratch url> pnpm exec jest db.spec
 */
import { RateLimiter } from '../rate-limit/rate-limiter';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { createInviteToken } from '../auth/invite-token';
import { PasswordResetService } from '../auth/password-reset/password-reset.service';
import { CustomersService } from '../customers/customers.service';
import { OrganisationsService } from '../organisations/organisations.service';
import { TrackersService } from '../trackers/trackers.service';
import { WorkflowRoutesService } from '../workflow/workflow-routes.service';
import { PrismaService } from './prisma.service';

const url = process.env.TEST_DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;

describeWithDatabase('related writes against PostgreSQL', () => {
  let prisma: PrismaService;
  let team: OrganisationsService;
  let customers: CustomersService;
  let trackers: TrackersService;
  let resets: PasswordResetService;
  let workflows: WorkflowRoutesService;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    const audit = new AuditService(prisma);
    const config = {
      get: (_key: string, fallback?: string) => fallback,
    } as never;
    const notifications = {
      sendStaffInvite: jest.fn().mockResolvedValue(true),
      sendPortalInvite: jest.fn().mockResolvedValue(true),
    } as never;
    const email = { localDelivery: () => true } as never;
    team = new OrganisationsService(
      prisma,
      audit,
      config,
      notifications,
      email,
    );
    customers = new CustomersService(
      prisma,
      config,
      audit,
      notifications,
      email,
    );
    trackers = new TrackersService(prisma, audit);
    resets = new PasswordResetService(
      prisma,
      {} as never,
      config,
      new RateLimiter(),
    );
    workflows = new WorkflowRoutesService(prisma, audit);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const email = () => `${randomUUID()}@example.test`;

  async function admin(organisationId: string) {
    const user = await prisma.user.create({
      data: { email: email(), name: 'Admin', passwordHash: 'x' },
    });
    const membership = await prisma.organisationMembership.create({
      data: {
        organisationId,
        userId: user.id,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    return {
      id: user.id,
      membershipId: membership.id,
      organisationId,
      role: 'ADMIN',
    } as AuthUser;
  }

  async function workspace() {
    const id = randomUUID();
    await prisma.organisation.create({ data: { id, name: id, slug: id } });
    return { organisationId: id, user: await admin(id) };
  }

  /**
   * Runs `work` while the database refuses one kind of write to the rows that
   * match `when`, to show what is left behind by a failure part way through.
   */
  async function whileRefusing(
    table: string,
    event: 'INSERT' | 'UPDATE',
    when: string,
    work: () => Promise<unknown>,
  ) {
    const name = `refuse_${randomUUID().replaceAll('-', '')}`;
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE ${event} ON "${table}" FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION ${name}()`,
    );
    try {
      await expect(work()).rejects.toThrow('refused');
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER ${name} ON "${table}"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION ${name}`);
    }
  }

  const liveStaffInvites = (organisationId: string) =>
    prisma.staffInvite.count({
      where: {
        organisationId,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

  const fiveTimes = (work: () => Promise<unknown>) =>
    Promise.all(Array.from({ length: 5 }, work));

  it('leaves one working link when the same person is invited at once', async () => {
    const w = await workspace();
    const address = email();
    const invite = () =>
      team.inviteStaff(w.user, {
        email: address,
        name: 'New Person',
        role: 'STAFF',
      });
    await fiveTimes(invite);
    expect(await prisma.user.count({ where: { email: address } })).toBe(1);
    expect(await liveStaffInvites(w.organisationId)).toBe(1);
    const member = await prisma.organisationMembership.findFirstOrThrow({
      where: { organisationId: w.organisationId, status: 'INVITED' },
    });
    await fiveTimes(() => team.resendInvite(w.user, member.id));
    expect(await liveStaffInvites(w.organisationId)).toBe(1);
  });

  it('saves nothing when a staff invite fails part way', async () => {
    const w = await workspace();
    const address = email();
    await whileRefusing(
      'StaffInvite',
      'INSERT',
      `NEW."organisationId" = '${w.organisationId}'`,
      () =>
        team.inviteStaff(w.user, {
          email: address,
          name: 'New Person',
          role: 'STAFF',
        }),
    );
    expect(await prisma.user.count({ where: { email: address } })).toBe(0);
    expect(
      await prisma.organisationMembership.count({
        where: { organisationId: w.organisationId },
      }),
    ).toBe(1);
  });

  it('keeps one Admin when two Admins demote each other at once', async () => {
    for (let round = 0; round < 5; round += 1) {
      const w = await workspace();
      const second = await admin(w.organisationId);
      const results = await Promise.allSettled([
        team.updateMember(w.user, second.membershipId, { role: 'STAFF' }),
        team.updateMember(second, w.user.membershipId, { role: 'STAFF' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        await prisma.organisationMembership.count({
          where: { organisationId: w.organisationId, role: 'ADMIN' },
        }),
      ).toBe(1);
    }
  });

  async function customerFor(organisationId: string) {
    return prisma.customer.create({
      data: {
        organisationId,
        firstName: 'Test',
        lastName: 'Customer',
        email: email(),
      },
    });
  }

  it('leaves one working link when a customer is invited at once', async () => {
    const w = await workspace();
    const customer = await customerFor(w.organisationId);
    await fiveTimes(() => customers.invite(w.user, customer.id));
    const where = { customerId: customer.id };
    expect(await prisma.organisationMembership.count({ where })).toBe(1);
    expect(
      await prisma.portalInvite.count({
        where: { ...where, expiresAt: { gt: new Date() } },
      }),
    ).toBe(1);
  });

  it('keeps a customer’s portal access and email when a change fails part way', async () => {
    const w = await workspace();
    const customer = await customerFor(w.organisationId);
    await customers.invite(w.user, customer.id);
    const where = { customerId: customer.id };
    const before = await prisma.organisationMembership.findFirstOrThrow({
      where,
      include: { user: true },
    });
    const changed = email();

    // The account's email moves first, then saving the customer fails.
    await whileRefusing(
      'Customer',
      'UPDATE',
      `OLD."id" = '${customer.id}'`,
      () => customers.update(w.user, customer.id, { email: changed }),
    );
    await expect(
      prisma.user.findUnique({ where: { id: before.userId } }),
    ).resolves.toMatchObject({ email: before.user.email });

    // The old access is removed first, then making the new invite fails.
    await prisma.customer.update({
      where: { id: customer.id },
      data: { email: changed },
    });
    await whileRefusing(
      'PortalInvite',
      'INSERT',
      `NEW."customerId" = '${customer.id}'`,
      () => customers.invite(w.user, customer.id),
    );
    await expect(
      prisma.organisationMembership.findMany({ where }),
    ).resolves.toMatchObject([{ userId: before.userId }]);
    expect(await prisma.user.count({ where: { email: changed } })).toBe(0);
  });

  async function resetLink() {
    const account = await prisma.user.create({
      data: { email: email(), name: 'Person', passwordHash: 'old' },
    });
    const { token, tokenHash } = createInviteToken();
    const reset = await prisma.passwordReset.create({
      data: {
        userId: account.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    return { token, account, reset };
  }

  it('does not use up a reset link when saving the password fails', async () => {
    const { token, account, reset } = await resetLink();
    await whileRefusing('User', 'UPDATE', `OLD."id" = '${account.id}'`, () =>
      resets.reset(token, 'a-brand-new-password'),
    );
    await expect(
      prisma.passwordReset.findUnique({ where: { id: reset.id } }),
    ).resolves.toMatchObject({ usedAt: null, expiresAt: reset.expiresAt });
    await resets.reset(token, 'a-brand-new-password');
    const saved = await prisma.user.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(saved.passwordHash).not.toBe('old');
  });

  it('lets a reset link work once when used twice at once', async () => {
    const { token } = await resetLink();
    const results = await Promise.allSettled([
      resets.reset(token, 'first-new-password'),
      resets.reset(token, 'second-new-password'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  async function fleet(organisationId: string) {
    const customer = await customerFor(organisationId);
    const jobs = [];
    const devices = [];
    for (let i = 0; i < 4; i += 1) {
      const vehicle = await prisma.vehicle.create({
        data: { organisationId },
      });
      jobs.push(
        await prisma.importJob.create({
          data: {
            organisationId,
            customerId: customer.id,
            vehicleId: vehicle.id,
            reference: `T-${i}`,
          },
        }),
      );
      devices.push(
        await prisma.tracker.create({
          data: {
            organisationId,
            serialNumber: `S-${i}`,
            provider: 'generic',
          },
        }),
      );
    }
    return { jobs, devices };
  }

  /** No tracker or job has two live assignments, and each status agrees. */
  async function expectConsistent(organisationId: string) {
    const live = await prisma.trackerAssignment.findMany({
      where: { organisationId, removedAt: null },
    });
    expect(new Set(live.map((a) => a.trackerId)).size).toBe(live.length);
    expect(new Set(live.map((a) => a.importJobId)).size).toBe(live.length);
    const devices = await prisma.tracker.findMany({
      where: { organisationId },
    });
    for (const device of devices) {
      expect(device.status).toBe(
        live.some((a) => a.trackerId === device.id) ? 'ASSIGNED' : 'AVAILABLE',
      );
    }
    return live;
  }

  it('keeps assignments one-to-one when trackers are assigned at once', async () => {
    const w = await workspace();
    const { jobs, devices } = await fleet(w.organisationId);
    // One tracker to every job, then every tracker to one job.
    await Promise.all(
      jobs.map((job) =>
        trackers.assign(w.user, job.id, { trackerId: devices[0].id }),
      ),
    );
    expect(await expectConsistent(w.organisationId)).toHaveLength(1);
    await Promise.all(
      devices.map((device) =>
        trackers.assign(w.user, jobs[0].id, { trackerId: device.id }),
      ),
    );
    const [live] = await expectConsistent(w.organisationId);
    const results = await Promise.allSettled([
      trackers.unassign(w.user, live.id),
      trackers.unassign(w.user, live.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await expectConsistent(w.organisationId)).toHaveLength(0);
  });

  it('keeps the old assignment when the new one fails', async () => {
    const w = await workspace();
    const { jobs, devices } = await fleet(w.organisationId);
    const old = await trackers.assign(w.user, jobs[0].id, {
      trackerId: devices[0].id,
    });
    await whileRefusing(
      'TrackerAssignment',
      'INSERT',
      `NEW."organisationId" = '${w.organisationId}'`,
      () => trackers.assign(w.user, jobs[0].id, { trackerId: devices[1].id }),
    );
    await expect(expectConsistent(w.organisationId)).resolves.toMatchObject([
      { id: old.id },
    ]);
  });

  it('will not remove a status that a job is reaching as the stage is saved', async () => {
    const w = await workspace();
    const route = await workflows.ensureDefault(w.organisationId);
    const stage = route.stages.find((s) => s.statuses.length > 1)!;
    const [kept, doomed] = stage.statuses;
    const { jobs } = await fleet(w.organisationId);
    let save: Promise<unknown> | undefined;
    // A job moved to the status, holding the route as a status change does,
    // and not yet committed when the save starts.
    await prisma.$transaction(async (tx) => {
      await workflows.holdStatus(tx, w.organisationId, route.id, doomed.code);
      await tx.importJob.update({
        where: { id: jobs[0].id },
        data: { routeId: route.id, status: doomed.code },
      });
      save = workflows
        .saveStage(w.user, route.id, stage.id, {
          name: stage.name,
          customerVisible: true,
          statuses: [kept, ...stage.statuses.slice(2)],
        })
        .catch((error: unknown) => error);
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    await expect(save).resolves.toMatchObject({
      message: expect.stringContaining('1 job is at'),
    });
    expect(
      await prisma.routeStatus.count({
        where: { routeId: route.id, code: doomed.code },
      }),
    ).toBe(1);
  });
});
