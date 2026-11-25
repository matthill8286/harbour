import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'argon2';
import type { UserRole } from '@vip/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuthService } from '../auth.service';
import type { AuthUser } from '../auth.types';
import { JwtStrategy } from '../jwt.strategy';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { mustSetUpTwoFactor } from './two-factor-policy';
import { TwoFactorService } from './two-factor.service';

const PASSWORD = 'ChangeMe!Admin1';
const config = {
  get: (_key: string, fallback?: string) => fallback,
} as ConfigService;

function account(twoFactorEnabled: boolean, passwordHash: string) {
  return {
    id: 'user-1',
    email: 'admin@demo.local',
    name: 'Admin',
    passwordHash,
    twoFactorEnabled,
    memberships: [
      {
        id: 'mem-1',
        organisationId: 'org-1',
        role: 'OWNER' as UserRole,
        status: 'ACTIVE',
        customerId: null,
        organisation: { name: 'Demo', status: 'ACTIVE', settings: null },
      },
    ],
  };
}

describe('two-step sign-in', () => {
  let passwordHash: string;
  const jwt = new JwtService({ secret: 'test-jwt-secret' });

  beforeAll(async () => {
    passwordHash = await hash(PASSWORD);
  });

  function services(twoFactorEnabled: boolean) {
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue(account(twoFactorEnabled, passwordHash)),
      },
    };
    const twoFactor = {
      createChallenge: jest.fn(
        TwoFactorService.prototype.createChallenge.bind({ jwt }),
      ),
      readChallenge: jest.fn(
        TwoFactorService.prototype.readChallenge.bind({ jwt }),
      ),
      verifySignIn: jest.fn().mockResolvedValue(undefined),
    };
    const auth = new AuthService(
      prisma as unknown as PrismaService,
      jwt,
      { record: jest.fn() } as unknown as AuditService,
      twoFactor as unknown as TwoFactorService,
    );
    const strategy = new JwtStrategy(
      config,
      prisma as unknown as PrismaService,
    );
    return { auth, twoFactor, strategy };
  }

  it('returns a session straight away when two-factor is off', async () => {
    const { auth } = services(false);
    const result = await auth.login({
      email: 'admin@demo.local',
      password: PASSWORD,
    });
    expect(result).toMatchObject({
      accessToken: expect.any(String),
      user: { id: 'user-1', twoFactorEnabled: false },
    });
  });

  it('returns a challenge, not a session, when two-factor is on', async () => {
    const { auth } = services(true);
    const result = await auth.login({
      email: 'admin@demo.local',
      password: PASSWORD,
    });
    expect(result).toMatchObject({
      twoFactorRequired: true,
      challengeToken: expect.any(String),
    });
    expect(result).not.toHaveProperty('accessToken');
  });

  it('swaps the challenge and a valid code for a session', async () => {
    const { auth, twoFactor } = services(true);
    const challenge = await auth.login({
      email: 'admin@demo.local',
      password: PASSWORD,
    });
    if (!('challengeToken' in challenge))
      throw new Error('expected a challenge');
    const session = await auth.completeTwoFactorChallenge({
      challengeToken: challenge.challengeToken,
      code: '123456',
    });
    expect(twoFactor.verifySignIn).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ code: '123456' }),
    );
    expect(session).toMatchObject({
      accessToken: expect.any(String),
      user: { twoFactorEnabled: true },
    });
  });

  it('will not accept a challenge token as an access token', async () => {
    const { auth, strategy } = services(true);
    const challenge = await auth.login({
      email: 'admin@demo.local',
      password: PASSWORD,
    });
    if (!('challengeToken' in challenge))
      throw new Error('expected a challenge');
    const payload = jwt.decode<{ sub: string; purpose?: string }>(
      challenge.challengeToken,
    );
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('two-factor enforcement', () => {
  const base: AuthUser = {
    id: 'user-1',
    email: 'a@demo.local',
    name: 'A',
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

  it('requires every staff role to set up two-factor, but not customers', () => {
    for (const role of ['OWNER', 'ADMIN', 'STAFF', 'VIEWER'] as UserRole[]) {
      expect(mustSetUpTwoFactor({ ...base, role })).toBe(true);
      expect(
        mustSetUpTwoFactor({ ...base, role, twoFactorEnabled: true }),
      ).toBe(false);
    }
    expect(
      mustSetUpTwoFactor({ ...base, role: 'CUSTOMER', customerId: 'c-1' }),
    ).toBe(false);
  });

  function context(user: AuthUser) {
    return {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    };
  }

  it('blocks staff routes until two-factor is on, unless the route allows setup', async () => {
    const reflector = new Reflector();
    const guard = new JwtAuthGuard(reflector);
    const parent = Object.getPrototypeOf(JwtAuthGuard.prototype) as {
      canActivate: () => Promise<boolean>;
    };
    jest.spyOn(parent, 'canActivate').mockResolvedValue(true);

    const ctx = context(base) as never;
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    await expect(
      guard.canActivate(context({ ...base, twoFactorEnabled: true }) as never),
    ).resolves.toBe(true);
  });
});
