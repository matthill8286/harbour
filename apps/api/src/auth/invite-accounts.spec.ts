/* eslint-disable @typescript-eslint/require-await -- the in-memory database answers at once */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from 'argon2';
import { AuditService } from '../audit/audit.service';
import { CustomersService } from '../customers/customers.service';
import { NotificationsService } from '../integrations/notifications.service';
import { EmailTransport } from '../integrations/email-transport';
import { RateLimiter } from '../rate-limit/rate-limiter';
import { OrganisationsService } from '../organisations/organisations.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import type { AuthUser } from './auth.types';
import { TwoFactorService } from './two-factor/two-factor.service';

/*
 * Every invite route, run through the real services with two organisations that
 * share one user table: "Own" holds the victim's account, "Other" is a stranger
 * who signed up and invites the same email.
 */

const VICTIM = 'victim@example.com';
const VICTIM_PASSWORD = 'the-victims-own-password';
const ATTACKER_PASSWORD = 'chosen-by-the-attacker';
const GOOD_CODE = '123456';

type Row = Record<string, unknown> & { id: string };
type Where = Record<string, unknown>;

/** Enough of Prisma, in memory, for the invite routes. */
function memoryDatabase() {
  const tables = {
    user: [] as Row[],
    organisation: [] as Row[],
    organisationMembership: [] as Row[],
    customer: [] as Row[],
    staffInvite: [] as Row[],
    portalInvite: [] as Row[],
  };
  type Table = keyof typeof tables;
  let sequence = 0;
  const find = (table: Table, id: unknown) =>
    tables[table].find((row) => row.id === id);

  function expand(table: Table, row: Row): Row {
    const out: Row = { ...row };
    if (table === 'organisation') out.settings = null;
    if ('organisationId' in row) {
      out.organisation = expand(
        'organisation',
        find('organisation', row.organisationId)!,
      );
    }
    if (table === 'organisationMembership' || table.endsWith('Invite')) {
      out.user = { ...find('user', row.userId)! };
    }
    if (table === 'portalInvite') {
      out.customer = { ...find('customer', row.customerId)! };
    }
    if (table === 'user') {
      out.memberships = tables.organisationMembership
        .filter((item) => item.userId === row.id)
        .map((item) => ({
          ...item,
          organisation: expand(
            'organisation',
            find('organisation', item.organisationId)!,
          ),
        }));
    }
    if (table === 'customer') {
      out.importJobs = [];
      out.memberships = tables.organisationMembership
        .filter((item) => item.customerId === row.id)
        .map((item) => ({ ...item, user: { ...find('user', item.userId)! } }));
      out.portalInvites = tables.portalInvite.filter(
        (item) =>
          item.customerId === row.id &&
          !item.acceptedAt &&
          (item.expiresAt as Date) > new Date(),
      );
    }
    return out;
  }

  function matches(table: Table, row: Row, where: Where = {}): boolean {
    return Object.entries(where).every(([key, want]) => {
      if (want === undefined) return true;
      if (key === 'organisationId_userId') {
        return matches(table, row, want as Where);
      }
      const have = row[key] ?? null;
      if (key === 'memberships') {
        const { every } = want as { every: Where };
        return tables.organisationMembership
          .filter((item) => item.userId === row.id)
          .every((item) => matches('organisationMembership', item, every));
      }
      if (want === null || typeof want !== 'object') return have === want;
      const filter = want as { not?: unknown; in?: unknown[]; gt?: Date };
      if ('not' in filter) return have !== filter.not;
      if (filter.in) return filter.in.includes(have);
      if (filter.gt) return (have as Date) > filter.gt;
      throw new Error(`Unsupported filter on ${key}`);
    });
  }

  function insert(table: Table, data: Where): Row {
    const row = {
      id: `${table}-${(sequence += 1)}`,
      createdAt: new Date(Date.now() + sequence),
      acceptedAt: null,
      ...(table === 'user'
        ? { passwordHash: null, twoFactorEnabled: false }
        : {}),
      ...data,
    } as Row;
    tables[table].push(row);
    return row;
  }

  const change = (row: Row, data: Where) => {
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) row[key] = value;
    }
    return row;
  };

  function model(table: Table) {
    const all = (where?: Where) =>
      tables[table].filter((row) => matches(table, row, where));
    const one = (where: Where) => {
      const row = all(where)[0];
      return row ? expand(table, row) : null;
    };
    const must = (where: Where) => {
      const row = one(where);
      if (!row) throw new Error(`No ${table}`);
      return row;
    };
    type Args = { where: Where; data: Where; create: Where; update: Where };
    return {
      findUnique: async ({ where }: Args) => one(where),
      findFirst: async ({ where }: Args) => one(where),
      findUniqueOrThrow: async ({ where }: Args) => must(where),
      findMany: async ({ where }: Args) =>
        all(where).map((row) => expand(table, row)),
      count: async ({ where }: Args) => all(where).length,
      create: async ({ data }: Args) => expand(table, insert(table, data)),
      update: async ({ where, data }: Args) =>
        expand(table, change(all(where)[0], data)),
      updateMany: async ({ where, data }: Args) => {
        const rows = all(where);
        rows.forEach((row) => change(row, data));
        return { count: rows.length };
      },
      upsert: async ({ where, create, update }: Args) => {
        const row = all(where)[0];
        return expand(table, row ? change(row, update) : insert(table, create));
      },
      deleteMany: async ({ where }: Args) => {
        const rows = all(where);
        tables[table] = tables[table].filter((row) => !rows.includes(row));
        return { count: rows.length };
      },
    };
  }

  const client = {
    user: model('user'),
    organisation: model('organisation'),
    organisationMembership: model('organisationMembership'),
    customer: model('customer'),
    staffInvite: model('staffInvite'),
    portalInvite: model('portalInvite'),
    $executeRaw: async () => 0,
    $transaction: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
      const names = Object.keys(tables) as Table[];
      const before = names.map((name) =>
        tables[name].map((row) => ({ ...row })),
      );
      try {
        return await work(client);
      } catch (error) {
        names.forEach((name, index) => (tables[name] = before[index]));
        throw error;
      }
    },
  };

  return { client, tables, insert };
}

describe('invites between two organisations', () => {
  let victimHash: string;
  const jwt = new JwtService({ secret: 'test-jwt-secret' });

  beforeAll(async () => {
    victimHash = await hash(VICTIM_PASSWORD);
  });

  function world(
    options: {
      twoFactor?: boolean;
      production?: boolean;
      mailDown?: boolean;
    } = {},
  ) {
    const db = memoryDatabase();
    const prisma = db.client as unknown as PrismaService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const config = {
      get: (_key: string, fallback?: string) => fallback,
    } as ConfigService;
    const twoFactor = {
      createChallenge: jest.fn(),
      verifySignIn: jest.fn(
        async (_userId: string, input: { code?: string }) => {
          if (input.code !== GOOD_CODE) {
            throw new UnauthorizedException('That code is not right.');
          }
        },
      ),
    };
    const auth = new AuthService(
      prisma,
      jwt,
      audit,
      twoFactor as unknown as TwoFactorService,
      new RateLimiter(),
    );
    // What reached an invitee's mailbox.
    const mailbox: { to?: string; inviteUrl: string }[] = [];
    const notifications = {
      sendStaffInvite: jest.fn(
        async (to: string, invite: { inviteUrl: string }) => {
          mailbox.push({ to, inviteUrl: invite.inviteUrl });
          return !options.mailDown;
        },
      ),
      sendPortalInvite: jest.fn(async (event: { inviteUrl: string }) => {
        mailbox.push({ inviteUrl: event.inviteUrl });
        return !options.mailDown;
      }),
    } as unknown as NotificationsService;
    // Local development hands the link back, which these tests accept with.
    const email = {
      localDelivery: () => !options.production,
    } as unknown as EmailTransport;
    const team = new OrganisationsService(
      prisma,
      audit,
      config,
      notifications,
      email,
    );
    const customers = new CustomersService(
      prisma,
      config,
      audit,
      notifications,
      email,
    );

    function organisation(name: string): AuthUser {
      const org = db.insert('organisation', { name, status: 'ACTIVE' });
      const admin = db.insert('user', {
        email: `admin@${name.toLowerCase()}.example`,
        name: `${name} Admin`,
        passwordHash: victimHash,
      });
      const membership = db.insert('organisationMembership', {
        organisationId: org.id,
        userId: admin.id,
        role: 'ADMIN',
        status: 'ACTIVE',
        customerId: null,
      });
      return {
        id: admin.id,
        membershipId: membership.id,
        organisationId: org.id,
        organisationName: name,
        organisationBrandName: name,
        organisationCurrency: 'EUR',
        organisationCountry: 'CY',
        email: admin.email as string,
        name: admin.name as string,
        role: 'ADMIN',
        customerId: null,
        twoFactorEnabled: true,
      };
    }

    const own = organisation('Own');
    const other = organisation('Other');

    function victim(passwordHash: string | null = victimHash) {
      return db.insert('user', {
        email: VICTIM,
        name: 'Vera Victim',
        passwordHash,
        twoFactorEnabled: Boolean(options.twoFactor),
      });
    }
    function member(
      actor: AuthUser,
      userId: string,
      values: Record<string, unknown>,
    ) {
      return db.insert('organisationMembership', {
        organisationId: actor.organisationId,
        userId,
        role: 'STAFF',
        status: 'ACTIVE',
        customerId: null,
        ...values,
      });
    }
    function customerOf(actor: AuthUser, email = VICTIM) {
      return db.insert('customer', {
        organisationId: actor.organisationId,
        firstName: 'Chosen',
        lastName: 'Name',
        email,
      });
    }
    const account = (id: string) => db.tables.user.find((u) => u.id === id)!;
    const membershipIn = (actor: AuthUser, userId: string) =>
      db.tables.organisationMembership.find(
        (m) => m.organisationId === actor.organisationId && m.userId === userId,
      );
    const byEmail = (email: string) =>
      db.tables.user.find((u) => u.email === email);
    const tokenOf = (inviteUrl?: string) => inviteUrl!.split('/invite/')[1];

    return {
      db,
      auth,
      team,
      customers,
      twoFactor,
      own,
      other,
      victim,
      member,
      customerOf,
      account,
      membershipIn,
      byEmail,
      tokenOf,
      mailbox,
    };
  }

  type World = ReturnType<typeof world>;

  /** The two ways an organisation can send an invite to an email. */
  const routes = [
    {
      kind: 'staff',
      send: (w: World, actor: AuthUser) =>
        w.team.inviteStaff(actor, {
          email: VICTIM,
          name: 'Renamed By Stranger',
          role: 'STAFF',
        }),
    },
    {
      kind: 'portal',
      send: (w: World, actor: AuthUser) =>
        w.customers.invite(actor, w.customerOf(actor).id),
    },
  ];

  describe.each(routes)('$kind invite to an existing account', ({ send }) => {
    it('leaves the account alone and waits for acceptance', async () => {
      const w = world();
      const user = w.victim();
      w.member(w.own, user.id, {});
      await send(w, w.other);

      expect(w.account(user.id)).toMatchObject({
        name: 'Vera Victim',
        email: VICTIM,
        passwordHash: victimHash,
      });
      expect(w.membershipIn(w.other, user.id)!.status).toBe('INVITED');
    });

    it('does not tell the sender or the link holder the account name', async () => {
      const w = world();
      w.victim();
      const sent = await send(w, w.other);
      const preview = await w.auth.previewInvite(w.tokenOf(sent.inviteUrl));

      expect(preview).toMatchObject({ existingAccount: true });
      expect(JSON.stringify(preview)).not.toContain('Vera');
      expect(JSON.stringify(await w.team.listMembers(w.other))).not.toContain(
        'Vera',
      );
      expect(JSON.stringify(sent)).not.toContain(victimHash);
    });

    it('cannot be accepted with a password the sender chooses', async () => {
      const w = world();
      const user = w.victim();
      const { inviteUrl } = await send(w, w.other);
      const token = w.tokenOf(inviteUrl);

      await expect(
        w.auth.acceptInvite(token, { password: ATTACKER_PASSWORD }),
      ).rejects.toThrow('not the password for this account');
      expect(w.account(user.id).passwordHash).toBe(victimHash);
      expect(w.membershipIn(w.other, user.id)!.status).toBe('INVITED');
      // The link still works for its real owner afterwards.
      await expect(w.auth.previewInvite(token)).resolves.toBeDefined();
    });

    it('is accepted with the existing password, which stays as it was', async () => {
      const w = world();
      const user = w.victim();
      const { inviteUrl } = await send(w, w.other);

      const session = await w.auth.acceptInvite(w.tokenOf(inviteUrl), {
        password: VICTIM_PASSWORD,
      });

      expect(session).toHaveProperty('accessToken');
      expect(w.account(user.id)).toMatchObject({
        name: 'Vera Victim',
        passwordHash: victimHash,
      });
      expect(w.membershipIn(w.other, user.id)).toMatchObject({
        status: 'ACTIVE',
        acceptedAt: expect.any(Date),
      });
    });

    it('needs the two-factor code as well where it is on', async () => {
      const w = world({ twoFactor: true });
      const user = w.victim();
      const { inviteUrl } = await send(w, w.other);
      const token = w.tokenOf(inviteUrl);
      const password = VICTIM_PASSWORD;

      await expect(
        w.auth.acceptInvite(token, { password }),
      ).rejects.toMatchObject({
        response: { code: 'invite_two_factor_required' },
      });
      await expect(
        w.auth.acceptInvite(token, { password, code: '000000' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(w.membershipIn(w.other, user.id)!.status).toBe('INVITED');

      await expect(
        w.auth.acceptInvite(token, { password, code: GOOD_CODE }),
      ).resolves.toHaveProperty('accessToken');
      expect(w.twoFactor.verifySignIn).toHaveBeenLastCalledWith(user.id, {
        code: GOOD_CODE,
        backupCode: undefined,
      });
      expect(w.account(user.id).passwordHash).toBe(victimHash);
    });

    it('gives a brand new account the password typed on accept, once', async () => {
      const w = world();
      const { inviteUrl } = await send(w, w.other);
      const token = w.tokenOf(inviteUrl);

      await expect(
        w.auth.acceptInvite(token, { password: 'too-short' }),
      ).rejects.toThrow('at least 10');
      await w.auth.acceptInvite(token, { password: VICTIM_PASSWORD });

      const stored = w.byEmail(VICTIM)!.passwordHash as string;
      expect(await verify(stored, VICTIM_PASSWORD)).toBe(true);
      await expect(
        w.auth.acceptInvite(token, { password: ATTACKER_PASSWORD }),
      ).rejects.toThrow('already been used');
    });
  });

  describe.each(routes)('$kind invite in production', ({ send }) => {
    it('goes to the invitee only, so the sender cannot set the password', async () => {
      const w = world({ production: true });
      const sent = await send(w, w.other);

      expect(sent).toMatchObject({ emailSent: true });
      expect(w.mailbox).toHaveLength(1);
      const token = w.tokenOf(w.mailbox[0].inviteUrl);
      expect(sent).not.toHaveProperty('inviteUrl');
      expect(JSON.stringify(sent)).not.toContain(token);
    });

    it('says when the email did not go, and still keeps the link back', async () => {
      const w = world({ production: true, mailDown: true });
      const sent = await send(w, w.other);

      expect(sent).toMatchObject({ emailSent: false });
      expect(sent).not.toHaveProperty('inviteUrl');
    });
  });

  it('keeps a resent staff invite from its sender too', async () => {
    const w = world({ production: true });
    const { member } = (await routes[0].send(w, w.other)) as {
      member: { id: string };
    };
    const resent = await w.team.resendInvite(w.other, member.id);

    expect(resent).not.toHaveProperty('inviteUrl');
    expect(w.mailbox.map((mail) => mail.to)).toEqual([VICTIM, VICTIM]);
  });

  it('counts password guesses by account, across both organisations’ links', async () => {
    const w = world();
    const user = w.victim();
    const links = [
      await routes[0].send(w, w.own),
      await routes[0].send(w, w.other),
    ].map((sent) => w.tokenOf(sent.inviteUrl));

    for (let i = 0; i < 10; i += 1) {
      await expect(
        w.auth.acceptInvite(links[i % 2], { password: ATTACKER_PASSWORD }),
      ).rejects.toThrow('not the password');
    }

    await expect(
      w.auth.acceptInvite(links[0], { password: VICTIM_PASSWORD }),
    ).rejects.toThrow('Too many attempts');
    // The same count guards sign-in.
    await expect(
      w.auth.login({ email: VICTIM, password: VICTIM_PASSWORD }),
    ).rejects.toThrow('Too many attempts');
    expect(w.account(user.id).passwordHash).toBe(victimHash);
  });

  it('keeps the other organisation’s link working, and still protects the account', async () => {
    const w = world();
    const first = await routes[0].send(w, w.own);
    const second = await routes[0].send(w, w.other);

    await w.auth.acceptInvite(w.tokenOf(first.inviteUrl), {
      password: VICTIM_PASSWORD,
    });

    await expect(
      w.auth.acceptInvite(w.tokenOf(second.inviteUrl), {
        password: ATTACKER_PASSWORD,
      }),
    ).rejects.toThrow('not the password');
    await expect(
      w.auth.acceptInvite(w.tokenOf(second.inviteUrl), {
        password: VICTIM_PASSWORD,
      }),
    ).resolves.toHaveProperty('accessToken');
  });

  it('switches off an unproven active membership when an account gets its first password', async () => {
    const w = world();
    const user = w.victim(null);
    w.member(w.own, user.id, { status: 'ACTIVE' });
    const { inviteUrl } = await routes[0].send(w, w.other);

    await w.auth.acceptInvite(w.tokenOf(inviteUrl), {
      password: ATTACKER_PASSWORD,
    });

    expect(w.membershipIn(w.own, user.id)!.status).toBe('INVITED');
  });

  describe('resending a staff invite', () => {
    it('gives a link that still needs the existing password', async () => {
      const w = world();
      const user = w.victim();
      const { member } = (await routes[0].send(w, w.other)) as {
        member: { id: string };
      };
      const resent = await w.team.resendInvite(w.other, member.id);

      expect(JSON.stringify(resent)).not.toContain('Vera');
      expect(JSON.stringify(resent)).not.toContain(victimHash);
      await expect(
        w.auth.acceptInvite(w.tokenOf(resent.inviteUrl), {
          password: ATTACKER_PASSWORD,
        }),
      ).rejects.toThrow('not the password');
      expect(w.account(user.id).passwordHash).toBe(victimHash);
    });

    it('is refused for a member of another organisation', async () => {
      const w = world();
      const user = w.victim();
      const theirs = w.member(w.own, user.id, { status: 'INVITED' });
      await expect(
        w.team.resendInvite(w.other, theirs.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updating a team member', () => {
    async function invited(w: World) {
      const user = w.victim();
      const sent = await w.team.inviteStaff(w.other, {
        email: VICTIM,
        name: 'Someone',
        role: 'STAFF',
      });
      return { user, id: sent.member.id, token: w.tokenOf(sent.inviteUrl) };
    }

    it('cannot make an unaccepted invite active, directly or by disabling it first', async () => {
      const w = world();
      const { user, id } = await invited(w);

      await expect(
        w.team.updateMember(w.other, id, { status: 'ACTIVE' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await w.team.updateMember(w.other, id, { status: 'DISABLED' });
      await expect(
        w.team.updateMember(w.other, id, { status: 'ACTIVE' }),
      ).rejects.toThrow('not accepted');
      expect(w.membershipIn(w.other, user.id)!.status).toBe('DISABLED');
    });

    it('stops the invite link once the member is disabled', async () => {
      const w = world();
      const { user, id, token } = await invited(w);
      await w.team.updateMember(w.other, id, { status: 'DISABLED' });

      await expect(
        w.auth.acceptInvite(token, { password: VICTIM_PASSWORD }),
      ).rejects.toThrow('expired');
      expect(w.membershipIn(w.other, user.id)!.status).toBe('DISABLED');
    });

    it('re-enables someone who had accepted', async () => {
      const w = world();
      const { id, token } = await invited(w);
      await w.auth.acceptInvite(token, { password: VICTIM_PASSWORD });

      await w.team.updateMember(w.other, id, { status: 'DISABLED' });
      await expect(
        w.team.updateMember(w.other, id, { status: 'ACTIVE' }),
      ).resolves.toMatchObject({
        status: 'ACTIVE',
        user: { name: 'Vera Victim' },
      });
    });

    it('re-enables a member from before acceptance was recorded', async () => {
      const w = world();
      const user = w.victim();
      const old = w.member(w.own, user.id, { status: 'ACTIVE' });

      await w.team.updateMember(w.own, old.id, { status: 'DISABLED' });
      await expect(
        w.team.updateMember(w.own, old.id, { status: 'ACTIVE' }),
      ).resolves.toMatchObject({ status: 'ACTIVE' });
    });

    it('is refused for a member of another organisation', async () => {
      const w = world();
      const user = w.victim();
      const theirs = w.member(w.own, user.id, {});
      await expect(
        w.team.updateMember(w.other, theirs.id, { status: 'DISABLED' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('re-inviting a customer', () => {
    it('keeps an accepted customer active', async () => {
      const w = world();
      const customer = w.customerOf(w.own);
      const first = await w.customers.invite(w.own, customer.id);
      await w.auth.acceptInvite(w.tokenOf(first.inviteUrl), {
        password: VICTIM_PASSWORD,
      });

      await w.customers.invite(w.own, customer.id);

      expect(w.membershipIn(w.own, w.byEmail(VICTIM)!.id)!.status).toBe(
        'ACTIVE',
      );
    });

    it('does not activate an account that never accepted', async () => {
      const w = world();
      const user = w.victim();
      const customer = w.customerOf(w.other);
      await w.customers.invite(w.other, customer.id);
      const again = await w.customers.invite(w.other, customer.id);

      expect(w.membershipIn(w.other, user.id)!.status).toBe('INVITED');
      expect(again.portal.status).toBe('INVITED');
    });
  });

  describe('editing a customer’s email', () => {
    async function portalCustomer(w: World, actor: AuthUser) {
      const customer = w.customerOf(actor);
      const sent = await w.customers.invite(actor, customer.id);
      return { customer, token: w.tokenOf(sent.inviteUrl) };
    }

    it('never changes the sign-in email of an account with a password', async () => {
      const w = world();
      const user = w.victim();
      const { customer } = await portalCustomer(w, w.other);

      const saved = await w.customers.update(w.other, customer.id, {
        email: 'attacker@example.com',
      });

      expect(saved.email).toBe('attacker@example.com');
      expect(w.account(user.id).email).toBe(VICTIM);
    });

    it('never changes the sign-in email of an account another organisation knows', async () => {
      const w = world();
      await portalCustomer(w, w.own);
      const { customer } = await portalCustomer(w, w.other);

      await w.customers.update(w.other, customer.id, {
        email: 'attacker@example.com',
      });

      expect(w.byEmail(VICTIM)).toBeDefined();
      expect(w.byEmail('attacker@example.com')).toBeUndefined();
    });

    it('corrects an unclaimed account of its own, and ends the old link', async () => {
      const w = world();
      const { customer, token } = await portalCustomer(w, w.own);

      await w.customers.update(w.own, customer.id, {
        email: 'corrected@example.com',
      });

      expect(w.byEmail('corrected@example.com')).toBeDefined();
      await expect(w.auth.previewInvite(token)).rejects.toThrow('expired');
    });

    it('will not move an unclaimed account onto another account’s email', async () => {
      const w = world();
      const { customer } = await portalCustomer(w, w.own);
      await expect(
        w.customers.update(w.own, customer.id, { email: w.other.email }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('moves portal access when the new email is invited', async () => {
      const w = world();
      const user = w.victim();
      const { customer, token } = await portalCustomer(w, w.own);
      await w.auth.acceptInvite(token, { password: VICTIM_PASSWORD });
      await w.customers.update(w.own, customer.id, {
        email: 'new@example.com',
      });

      await w.customers.invite(w.own, customer.id);

      expect(w.membershipIn(w.own, user.id)).toBeUndefined();
      expect(
        w.membershipIn(w.own, w.byEmail('new@example.com')!.id),
      ).toMatchObject({ status: 'INVITED', customerId: customer.id });
      expect(w.account(user.id)).toMatchObject({
        email: VICTIM,
        passwordHash: victimHash,
      });
    });

    it('is refused for another organisation’s customer', async () => {
      const w = world();
      const { customer } = await portalCustomer(w, w.own);
      await expect(
        w.customers.update(w.other, customer.id, { email: 'x@example.com' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        w.customers.invite(w.other, customer.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
