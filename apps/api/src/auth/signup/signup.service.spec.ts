/* eslint-disable @typescript-eslint/require-await -- the in-memory database answers at once */
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { verify } from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { EmailTransport } from '../../integrations/email-transport';
import { RateLimiter } from '../../rate-limit/rate-limiter';
import { SIGNUP_DAILY_EMAILS, SignupService } from './signup.service';
import { organisationSlug } from './signup';
import { currentLegalVersions } from '@vip/shared';

const TERMS = currentLegalVersions();

describe('organisationSlug', () => {
  it('makes a readable, unique slug', () => {
    expect(organisationSlug('Ánna’s Car Imports Ltd.')).toMatch(
      /^anna-s-car-imports-ltd-[0-9a-f]{6}$/,
    );
    expect(organisationSlug('!!!')).toMatch(/^workspace-[0-9a-f]{6}$/);
    expect(organisationSlug('Same')).not.toBe(organisationSlug('Same'));
  });
});

type Request = {
  id: string;
  email: string;
  organisationName: string;
  name: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
};

type Account = {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
};

describe('SignupService', () => {
  const jwt = new JwtService({ secret: 'test-jwt-secret' });
  const audit = { record: jest.fn() };
  const config = {
    get: (_key: string, fallback?: string) => fallback,
  } as ConfigService;

  const OWNER = {
    id: 'user-owner',
    email: 'owner@example.com',
    name: 'Olive Owner',
    passwordHash: 'a-saved-hash',
  };
  const INVITED = {
    id: 'user-invited',
    email: 'invited@example.com',
    name: 'Invited',
    passwordHash: null,
  };

  function setup() {
    const requests: Request[] = [];
    const users: Account[] = [{ ...OWNER }, { ...INVITED }];
    type Where = {
      id?: string;
      email?: string;
      usedAt?: null;
      expiresAt?: { gt?: Date; lte?: Date };
    };
    const matches = (row: Request, where: Where) =>
      (where.id === undefined || row.id === where.id) &&
      (where.email === undefined || row.email === where.email) &&
      (where.usedAt === undefined || row.usedAt === null) &&
      (!where.expiresAt?.gt || row.expiresAt > where.expiresAt.gt) &&
      (!where.expiresAt?.lte || row.expiresAt <= where.expiresAt.lte);

    const prisma = {
      signupRequest: {
        create: jest.fn(
          async ({ data }: { data: Omit<Request, 'id' | 'usedAt'> }) => {
            const row = {
              id: `req-${requests.length + 1}`,
              usedAt: null,
              ...data,
            };
            requests.push(row);
            return row;
          },
        ),
        findUnique: jest.fn(
          async ({ where }: { where: { tokenHash: string } }) =>
            requests.find((r) => r.tokenHash === where.tokenHash) ?? null,
        ),
        updateMany: jest.fn(
          async ({ where, data }: { where: Where; data: Partial<Request> }) => {
            const hit = requests.filter((r) => matches(r, where));
            hit.forEach((r) => Object.assign(r, data));
            return { count: hit.length };
          },
        ),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      user: {
        findUnique: jest.fn(
          async ({ where }: { where: { email: string } }) =>
            users.find((u) => u.email === where.email) ?? null,
        ),
        create: jest.fn(async ({ data }: { data: Omit<Account, 'id'> }) => {
          const user = { id: 'user-new', ...data };
          users.push(user);
          return user;
        }),
        updateMany: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string };
            data: Partial<Account>;
          }) => {
            const hit = users.filter(
              (u) => u.id === where.id && u.passwordHash === null,
            );
            hit.forEach((u) => Object.assign(u, data));
            return { count: hit.length };
          },
        ),
      },
      organisation: {
        create: jest.fn().mockResolvedValue({ id: 'org-new' }),
      },
      organisationMembership: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({
          id: 'mem-new',
          organisationId: 'org-new',
          role: 'ADMIN',
          customerId: null,
          organisation: {
            name: 'Anna Imports',
            currency: 'EUR',
            country: 'CY',
            settings: { brandName: 'Anna Imports' },
          },
        }),
      },
      termsAcceptance: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(async (call: { data: object }) => ({
          id: `terms-${Math.random()}`,
          ...call.data,
        })),
      },
      auditLog: { create: jest.fn() },
      $executeRaw: jest.fn(),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((run: (tx: unknown) => unknown) =>
      run(prisma),
    );
    const mail: { to: string; subject: string; text: string; html: string }[] =
      [];
    const email = {
      deliver: jest.fn(async (message: (typeof mail)[number]) => {
        mail.push(message);
        return { provider: 'brevo' };
      }),
    };
    const service = new SignupService(
      prisma as unknown as PrismaService,
      jwt,
      audit as unknown as AuditService,
      email as unknown as EmailTransport,
      config,
      new RateLimiter(),
    );
    return { service, prisma, requests, users, mail, email };
  }

  const dto = {
    organisationName: '  Anna Imports ',
    name: ' Anna ',
    email: ' Anna@Example.com ',
  };
  const linkIn = (text: string) =>
    /signup\/confirm\/([A-Za-z0-9_-]+)/.exec(text)![1];

  it('creates nothing but an email until the link is used', async () => {
    const { service, prisma, mail } = setup();
    await expect(service.request(dto)).resolves.toBeUndefined();

    expect(mail).toHaveLength(1);
    expect(mail[0].to).toBe('anna@example.com');
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.organisation.create).not.toHaveBeenCalled();
  });

  it('puts nothing the caller typed into the email', async () => {
    const { service, mail } = setup();
    await service.request({
      organisationName: 'Buy now at spam.test',
      name: 'Free money',
      email: 'someone@example.com',
    });
    const sent = JSON.stringify(mail[0]);
    expect(sent).not.toContain('spam.test');
    expect(sent).not.toContain('Free money');
  });

  it('answers an email with an account the same way, and tells only its owner', async () => {
    const { service, mail, users } = setup();
    await expect(
      service.request({ ...dto, email: OWNER.email }),
    ).resolves.toBeUndefined();

    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toContain('already have');
    expect(mail[0].text).not.toContain('/signup/confirm/');
    expect(users.find((u) => u.id === OWNER.id)).toEqual(OWNER);
  });

  it('creates the workspace with the password chosen from the mailbox', async () => {
    const { service, prisma, mail, users } = setup();
    await service.request(dto);
    const token = linkIn(mail[0].text);
    await expect(service.check(token)).resolves.toMatchObject({
      email: 'anna@example.com',
      organisationName: 'Anna Imports',
      name: 'Anna',
    });

    const result = await service.confirm(token, 'a-long-password', TERMS);

    const org = prisma.organisation.create.mock.calls[0][0].data;
    expect(org.slug).toMatch(/^anna-imports-[0-9a-f]{6}$/);
    expect(org.subscription).toEqual({
      create: { plan: 'STARTER', status: 'TRIAL' },
    });
    expect(org.features.create).toEqual([
      { flag: 'GPS_TRACKING', enabled: true },
      { flag: 'CUSTOMER_PORTAL', enabled: true },
    ]);
    const user = users.find((u) => u.email === 'anna@example.com')!;
    expect(await verify(user.passwordHash!, 'a-long-password')).toBe(true);
    expect(
      prisma.organisationMembership.create.mock.calls[0][0].data,
    ).toMatchObject({ role: 'ADMIN', status: 'ACTIVE' });
    expect(jwt.decode(result.accessToken)).toMatchObject({
      sub: 'user-new',
      membershipId: 'mem-new',
    });
    expect(
      prisma.termsAcceptance.create.mock.calls.map(
        ([call]: [{ data: object }]) => call.data,
      ),
    ).toEqual(
      Object.entries(TERMS).map(([document, version]): unknown =>
        expect.objectContaining({
          organisationId: 'org-new',
          document,
          version,
          acceptedById: 'user-new',
          acceptedByEmail: 'anna@example.com',
        }),
      ),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(3);
  });

  it('creates nothing when the accepted versions are not the current ones', async () => {
    const { service, prisma, mail } = setup();
    await service.request(dto);
    const token = linkIn(mail[0].text);
    for (const versions of [
      {},
      { ...TERMS, TERMS_OF_SERVICE: 'an-old-version' },
      { ...TERMS, SOMETHING_ELSE: 'x' },
    ]) {
      await expect(
        service.confirm(token, 'a-long-password', versions),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.organisation.create).not.toHaveBeenCalled();
    await expect(service.check(token)).resolves.toBeTruthy();
  });

  it('uses each link once, and ends the other links for that email', async () => {
    const { service, mail } = setup();
    await service.request(dto);
    await service.request(dto);
    const [first, second] = mail.map((m) => linkIn(m.text));

    await service.confirm(second, 'a-long-password', TERMS);

    for (const token of [first, second, 'made-up', '']) {
      await expect(
        service.confirm(token, 'another-password', TERMS),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('keeps the owner’s link working after someone else asks too', async () => {
    const { service, mail } = setup();
    await service.request(dto);
    await service.request({ ...dto, organisationName: 'Stranger' });
    await expect(service.check(linkIn(mail[0].text))).resolves.toMatchObject({
      organisationName: 'Anna Imports',
    });
  });

  it('refuses an expired link', async () => {
    const { service, mail, requests } = setup();
    await service.request(dto);
    requests[0].expiresAt = new Date(Date.now() - 1);
    await expect(service.check(linkIn(mail[0].text))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('never changes an account that got a password after the link was sent', async () => {
    const { service, mail, users, prisma } = setup();
    await service.request({ ...dto, email: INVITED.email });
    users.find((u) => u.id === INVITED.id)!.passwordHash = 'chosen-elsewhere';

    await expect(
      service.confirm(linkIn(mail[0].text), 'a-long-password', TERMS),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(users.find((u) => u.id === INVITED.id)!.passwordHash).toBe(
      'chosen-elsewhere',
    );
    expect(prisma.organisation.create).not.toHaveBeenCalled();
  });

  it('lets the owner of an invited, unclaimed email sign up', async () => {
    const { service, mail, users, prisma } = setup();
    await service.request({ ...dto, email: INVITED.email });
    await service.confirm(linkIn(mail[0].text), 'a-long-password', TERMS);

    expect(users.find((u) => u.id === INVITED.id)!.passwordHash).toBeTruthy();
    expect(prisma.organisationMembership.updateMany).toHaveBeenCalledWith({
      where: { userId: INVITED.id, status: 'ACTIVE' },
      data: { status: 'INVITED', acceptedAt: null },
    });
  });

  it('says so when the email cannot be sent, whoever the address belongs to', async () => {
    for (const address of ['new@example.com', OWNER.email]) {
      const { service, email } = setup();
      email.deliver.mockRejectedValueOnce(new Error('Brevo returned 429'));
      await expect(
        service.request({ ...dto, email: address }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    }
  });

  it('limits the emails one address can be sent', async () => {
    const { service, mail } = setup();
    for (let i = 0; i < 3; i += 1) await service.request(dto);
    await expect(service.request(dto)).rejects.toThrow('Too many attempts');
    expect(mail).toHaveLength(3);
  });

  it('limits the sign-up emails sent in a day to all addresses', async () => {
    const { service, mail } = setup();
    for (let i = 0; i < SIGNUP_DAILY_EMAILS; i += 1) {
      await service.request({ ...dto, email: `p${i}@example.com` });
    }
    await expect(
      service.request({ ...dto, email: 'one-more@example.com' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mail).toHaveLength(SIGNUP_DAILY_EMAILS);
  });
});
