import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Licence, LicenceStatus } from '../licensing/licence';
import type { LicensingService } from '../licensing/licensing.service';
import type { PrismaService } from '../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

const config = {
  get: (_key: string, fallback?: string) => fallback,
} as ConfigService;

const prisma = {
  user: {
    findUnique: jest.fn().mockResolvedValue({
      id: 'user-1',
      email: 'admin@imports.test',
      name: 'Admin',
      twoFactorEnabled: true,
      memberships: [
        {
          id: 'mem-1',
          organisationId: 'org-1',
          role: 'ADMIN',
          status: 'ACTIVE',
          customerId: null,
          organisation: {
            name: 'Imports',
            status: 'ACTIVE',
            settings: null,
            subscription: null,
          },
        },
      ],
    }),
  },
} as unknown as PrismaService;

const licence = (status: LicenceStatus): Licence => ({
  id: 'lic-1',
  plan: 'desk',
  status,
  seats: null,
  limits: {},
  endsAt: null,
  graceEndsAt: null,
  readOnlyEndsAt: null,
  tenant: 'org-1',
  owners: [],
});

/** A session checked against a licensing service that answers with `found`. */
function validate(found: Licence | null, enabled = true) {
  const forWorkspace = jest.fn().mockResolvedValue(found);
  const strategy = new JwtStrategy(config, prisma, {
    enabled,
    forWorkspace,
  } as unknown as LicensingService);
  return {
    forWorkspace,
    user: strategy.validate({ sub: 'user-1', membershipId: 'mem-1' }),
  };
}

describe("a session and its workspace's licence", () => {
  it('works fully while the licence is active or in its grace period', async () => {
    for (const status of ['active', 'grace'] as const) {
      const { user, forWorkspace } = validate(licence(status));
      expect((await user).workspaceReadOnly).toBeUndefined();
      expect(forWorkspace).toHaveBeenCalledWith('org-1');
    }
  });

  it('is read-only once the licence has run out', async () => {
    for (const status of ['read_only', 'expired'] as const) {
      expect((await validate(licence(status)).user).workspaceReadOnly).toBe(
        true,
      );
    }
  });

  it('is refused when the licence is suspended, has not started or does not exist', async () => {
    for (const found of [licence('suspended'), licence('pending'), null]) {
      const refused = validate(found).user;
      await expect(refused).rejects.toBeInstanceOf(ForbiddenException);
      await expect(refused).rejects.toMatchObject({
        response: { code: 'licence_inactive' },
      });
    }
  });

  it('asks nothing where licences are not checked', async () => {
    const { user, forWorkspace } = validate(null, false);
    expect((await user).organisationId).toBe('org-1');
    expect(forWorkspace).not.toHaveBeenCalled();
    const plain = new JwtStrategy(config, prisma);
    expect(
      (await plain.validate({ sub: 'user-1', membershipId: 'mem-1' })).id,
    ).toBe('user-1');
  });
});
