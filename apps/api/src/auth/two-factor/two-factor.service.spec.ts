import { HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthUser } from '../auth.types';
import { issuedBeforePasswordChange } from '../jwt.strategy';
import { MAX_FAILED_ATTEMPTS, TwoFactorService } from './two-factor.service';
import { totpCode } from './totp';

type Row = {
  id: string;
  userId: string;
  secret: string;
  backupCodes: string;
  verified: boolean;
  failedVerificationCount: number;
  lockedUntil: Date | null;
  lastUsedStep: number | null;
};

const PASSWORD = 'ChangeMe!Staff1';

type Values = Record<string, unknown>;

/** The filters the service uses, applied to one row. */
function matches(row: Values, where: Values): boolean {
  return Object.entries(where).every(([key, want]) => {
    if (key === 'OR') {
      return (want as Values[]).some((option) => matches(row, option));
    }
    const have = row[key] ?? null;
    if (want === null || typeof want !== 'object') return have === want;
    const filter = want as { lt?: number; gte?: number; lte?: Date };
    if (have === null) return false;
    if (filter.lt !== undefined) return (have as number) < filter.lt;
    if (filter.gte !== undefined) return (have as number) >= filter.gte;
    if (filter.lte) return (have as Date) <= filter.lte;
    throw new Error(`Unsupported filter on ${key}`);
  });
}

function apply(row: Values, data: Values) {
  for (const [key, value] of Object.entries(data)) {
    const step = (value as { increment?: number } | null)?.increment;
    row[key] = step === undefined ? value : (row[key] as number) + step;
  }
}

/**
 * Just enough of Prisma, in memory, to drive the two-factor flows end to end.
 * As in the database, updateMany checks and writes in one step.
 */
function fakePrisma(passwordHash: string) {
  const users = new Map([
    [
      'user-1',
      {
        id: 'user-1',
        email: 'staff@demo.local',
        passwordHash,
        twoFactorEnabled: false,
        sessionsRevokedAt: null as Date | null,
        passwordCheckFailedCount: 0,
        passwordCheckLockedUntil: null as Date | null,
      },
    ],
  ]);
  const rows = new Map<string, Row>();
  const byId = (id: string) => [...rows.values()].find((row) => row.id === id);
  const updateIfMatching = (
    row: object | undefined,
    where: Values,
    data: Values,
  ) => {
    if (!row || !matches(row as Values, where)) {
      return Promise.resolve({ count: 0 });
    }
    apply(row as Values, data);
    return Promise.resolve({ count: 1 });
  };
  type Args = { where: { id: string } & Values; data: Values };
  const prisma = {
    user: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) => {
        const user = users.get(where.id);
        return Promise.resolve(user ? { ...user } : null);
      }),
      update: jest.fn(({ where, data }: Args) => {
        apply(users.get(where.id)!, data);
        return Promise.resolve(users.get(where.id));
      }),
      updateMany: jest.fn(({ where, data }: Args) =>
        updateIfMatching(users.get(where.id), where, data),
      ),
    },
    twoFactor: {
      findUnique: jest.fn(({ where }: { where: { userId: string } }) => {
        const row = rows.get(where.userId);
        // A copy, so a caller holds what it read, not what the row becomes.
        return Promise.resolve(row ? { ...row } : null);
      }),
      upsert: jest.fn(
        ({
          where,
          create,
          update,
        }: {
          where: { userId: string };
          create: Omit<Row, 'id'>;
          update: Partial<Row>;
        }) => {
          const existing = rows.get(where.userId);
          if (existing) Object.assign(existing, update);
          else rows.set(where.userId, { id: `tf-${where.userId}`, ...create });
          return Promise.resolve(rows.get(where.userId));
        },
      ),
      update: jest.fn(({ where, data }: Args) => {
        apply(byId(where.id)!, data);
        return Promise.resolve(byId(where.id));
      }),
      updateMany: jest.fn(({ where, data }: Args) =>
        updateIfMatching(byId(where.id), where, data),
      ),
      deleteMany: jest.fn(({ where }: { where: { userId: string } }) => {
        rows.delete(where.userId);
        return Promise.resolve({ count: 1 });
      }),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { prisma, users, rows };
}

/** The code the app shows next, for when the current one has been used. */
const nextCode = (secret: string) => totpCode(secret, Date.now() + 30_000);

describe('TwoFactorService', () => {
  let passwordHash: string;
  const jwt = new JwtService({ secret: 'test-jwt-secret' });
  const config = {
    get: (key: string, fallback?: string) =>
      key === 'TWO_FACTOR_ENCRYPTION_KEY' ? 'test-encryption-key' : fallback,
  } as ConfigService;
  const audit = { record: jest.fn() };
  const user: AuthUser = {
    id: 'user-1',
    email: 'staff@demo.local',
    name: 'Staff',
    role: 'STAFF',
    organisationId: 'org-1',
    membershipId: 'mem-1',
    customerId: null,
    organisationName: 'Demo',
    organisationBrandName: 'Demo',
    organisationCurrency: 'EUR',
    organisationCountry: 'CY',
    twoFactorEnabled: false,
  };

  beforeAll(async () => {
    passwordHash = await hash(PASSWORD);
  });

  function setup() {
    const fake = fakePrisma(passwordHash);
    const service = new TwoFactorService(
      fake.prisma as unknown as PrismaService,
      jwt,
      audit as unknown as AuditService,
      config,
    );
    return { ...fake, service };
  }

  async function enrol(service: TwoFactorService) {
    const started = await service.enable(user, PASSWORD);
    await service.verifyEnrolment(user, totpCode(started.secret));
    return started;
  }

  it('needs the password to start setup', async () => {
    const { service } = setup();
    await expect(service.enable(user, 'wrong-password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('stores the secret and backup codes encrypted, and only switches on after a valid code', async () => {
    const { service, rows, users } = setup();
    const started = await service.enable(user, PASSWORD);
    expect(new URL(started.totpURI).searchParams.get('secret')).toBe(
      started.secret,
    );
    expect(started.backupCodes).toHaveLength(10);
    const row = rows.get('user-1')!;
    expect(row.secret).not.toContain(started.secret);
    expect(row.backupCodes).not.toContain(started.backupCodes[0]);
    expect(row.verified).toBe(false);
    expect(users.get('user-1')!.twoFactorEnabled).toBe(false);

    await expect(
      service.verifyEnrolment(user, '000000'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await service.verifyEnrolment(user, totpCode(started.secret));
    expect(row.verified).toBe(true);
    expect(users.get('user-1')!.twoFactorEnabled).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ action: 'TWO_FACTOR_ENABLED' }),
    );
  });

  it('refuses to start setup again while two-factor is on', async () => {
    const { service } = setup();
    await enrol(service);
    await expect(service.enable(user, PASSWORD)).rejects.toThrow('already on');
  });

  it('accepts an authenticator code at sign-in', async () => {
    const { service } = setup();
    const { secret } = await enrol(service);
    await expect(
      service.verifySignIn('user-1', { code: nextCode(secret) }),
    ).resolves.toBeUndefined();
  });

  it('accepts each authenticator code only once, even sent twice together', async () => {
    const { service } = setup();
    const { secret } = await enrol(service);
    const code = nextCode(secret);

    const results = await Promise.allSettled([
      service.verifySignIn('user-1', { code }),
      service.verifySignIn('user-1', { code }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    await expect(service.verifySignIn('user-1', { code })).rejects.toThrow(
      'already been used',
    );
    // Nor can an earlier step be used after a later one.
    await expect(
      service.verifySignIn('user-1', { code: totpCode(secret) }),
    ).rejects.toThrow('already been used');
  });

  it('counts guesses sent together, and checks no more than the limit', async () => {
    const { service, rows, prisma } = setup();
    await enrol(service);
    prisma.twoFactor.updateMany.mockClear();

    const results = await Promise.allSettled(
      Array.from({ length: MAX_FAILED_ATTEMPTS * 3 }, () =>
        service.verifySignIn('user-1', { code: '000000' }),
      ),
    );

    const statuses = results.map((result) =>
      result.status === 'rejected'
        ? (result.reason as HttpException).getStatus()
        : 200,
    );
    expect(statuses.filter((s) => s === 401)).toHaveLength(MAX_FAILED_ATTEMPTS);
    expect(statuses.filter((s) => s === 429)).toHaveLength(
      MAX_FAILED_ATTEMPTS * 2,
    );
    expect(rows.get('user-1')!.lockedUntil!.getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it('ends older sessions when it is turned on, and hands back one that works', async () => {
    const { service, users } = setup();
    const before = Math.floor(Date.now() / 1000) - 1;
    const started = await service.enable(user, PASSWORD);

    const result = await service.verifyEnrolment(
      user,
      totpCode(started.secret),
    );

    const cutOff = users.get('user-1')!.sessionsRevokedAt;
    expect(issuedBeforePasswordChange(before, cutOff)).toBe(true);
    const payload = jwt.decode<{ iat: number; membershipId: string }>(
      result.accessToken,
    );
    expect(payload.membershipId).toBe('mem-1');
    expect(issuedBeforePasswordChange(payload.iat, cutOff)).toBe(false);
    expect(result.user.twoFactorEnabled).toBe(true);
  });

  it('lets each backup code sign in once', async () => {
    const { service } = setup();
    const { backupCodes } = await enrol(service);
    await service.verifySignIn('user-1', {
      backupCode: backupCodes[0].toUpperCase(),
    });
    await expect(
      service.verifySignIn('user-1', { backupCode: backupCodes[0] }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.status({ ...user, twoFactorEnabled: true }),
    ).resolves.toEqual({ enabled: true, backupCodesRemaining: 9 });
  });

  it('locks out after repeated wrong codes', async () => {
    const { service, rows } = setup();
    const { secret } = await enrol(service);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
      await expect(
        service.verifySignIn('user-1', { code: '000000' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    expect(rows.get('user-1')!.lockedUntil).toBeInstanceOf(Date);
    const locked = service.verifySignIn('user-1', { code: totpCode(secret) });
    await expect(locked).rejects.toBeInstanceOf(HttpException);
    await expect(locked).rejects.toMatchObject({ status: 429 });
  });

  it('regenerates backup codes and invalidates the old ones', async () => {
    const { service, users } = setup();
    const { backupCodes } = await enrol(service);
    const enabledUser = { ...user, twoFactorEnabled: true };
    expect(users.get('user-1')!.twoFactorEnabled).toBe(true);
    await expect(
      service.regenerateBackupCodes(enabledUser, PASSWORD, {}),
    ).rejects.toThrow('Enter a code');
    const fresh = await service.regenerateBackupCodes(enabledUser, PASSWORD, {
      backupCode: backupCodes[1],
    });
    expect(fresh.backupCodes).toHaveLength(10);
    await expect(
      service.verifySignIn('user-1', { backupCode: backupCodes[0] }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await service.verifySignIn('user-1', { backupCode: fresh.backupCodes[0] });
  });

  it('turns two-factor off only with the password and a code', async () => {
    const { service, rows, users } = setup();
    const { secret } = await enrol(service);
    const code = nextCode(secret);
    await expect(
      service.disable(user, 'nope', { code }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.disable(user, PASSWORD, {})).rejects.toThrow(
      'Enter a code',
    );
    await expect(
      service.disable(user, PASSWORD, { code: '000000' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(rows.has('user-1')).toBe(true);
    await service.disable(user, PASSWORD, { code });
    expect(rows.has('user-1')).toBe(false);
    expect(users.get('user-1')!.twoFactorEnabled).toBe(false);
  });

  it('limits password tries on the two-factor settings', async () => {
    const { service, users } = setup();

    const results = await Promise.allSettled(
      Array.from({ length: MAX_FAILED_ATTEMPTS + 5 }, () =>
        service.enable(user, 'wrong-password'),
      ),
    );

    expect(
      results.filter(
        (r) =>
          r.status === 'rejected' &&
          (r.reason as HttpException).getStatus() === 429,
      ),
    ).toHaveLength(5);
    expect(users.get('user-1')!.passwordCheckLockedUntil).toBeInstanceOf(Date);
    await expect(service.enable(user, PASSWORD)).rejects.toMatchObject({
      status: 429,
    });
    // Once the lock has passed, the right password works and clears the count.
    users.get('user-1')!.passwordCheckLockedUntil = new Date(Date.now() - 1);
    await expect(service.enable(user, PASSWORD)).resolves.toBeDefined();
    expect(users.get('user-1')!.passwordCheckFailedCount).toBe(0);
  });

  it('only accepts challenge tokens it issued for the two-factor step', async () => {
    const { service } = setup();
    const { challengeToken, twoFactorRequired } = await service.createChallenge(
      'user-1',
      'mem-1',
    );
    expect(twoFactorRequired).toBe(true);
    await expect(service.readChallenge(challengeToken)).resolves.toMatchObject({
      sub: 'user-1',
      membershipId: 'mem-1',
    });
    const accessToken = await jwt.signAsync({
      sub: 'user-1',
      membershipId: 'mem-1',
    });
    await expect(service.readChallenge(accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
