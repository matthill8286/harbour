import { HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthUser } from '../auth.types';
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
};

const PASSWORD = 'ChangeMe!Staff1';

/** Just enough of Prisma, in memory, to drive the two-factor flows end to end. */
function fakePrisma(passwordHash: string) {
  const users = new Map([
    [
      'user-1',
      {
        id: 'user-1',
        email: 'staff@demo.local',
        passwordHash,
        twoFactorEnabled: false,
      },
    ],
  ]);
  const rows = new Map<string, Row>();
  const byId = (id: string) => [...rows.values()].find((row) => row.id === id);
  const prisma = {
    user: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(users.get(where.id) ?? null),
      ),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: object }) => {
          Object.assign(users.get(where.id)!, data);
          return Promise.resolve(users.get(where.id));
        },
      ),
    },
    twoFactor: {
      findUnique: jest.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve(rows.get(where.userId) ?? null),
      ),
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
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
          Object.assign(byId(where.id)!, data);
          return Promise.resolve(byId(where.id));
        },
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string; backupCodes: string };
          data: Partial<Row>;
        }) => {
          const row = byId(where.id);
          if (!row || row.backupCodes !== where.backupCodes) {
            return Promise.resolve({ count: 0 });
          }
          Object.assign(row, data);
          return Promise.resolve({ count: 1 });
        },
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
      service.verifySignIn('user-1', { code: totpCode(secret) }),
    ).resolves.toBeUndefined();
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
    const fresh = await service.regenerateBackupCodes(enabledUser, PASSWORD);
    expect(fresh.backupCodes).toHaveLength(10);
    await expect(
      service.verifySignIn('user-1', { backupCode: backupCodes[0] }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await service.verifySignIn('user-1', { backupCode: fresh.backupCodes[0] });
  });

  it('turns two-factor off with the password', async () => {
    const { service, rows, users } = setup();
    await enrol(service);
    await expect(service.disable(user, 'nope')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await service.disable(user, PASSWORD);
    expect(rows.has('user-1')).toBe(false);
    expect(users.get('user-1')!.twoFactorEnabled).toBe(false);
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
