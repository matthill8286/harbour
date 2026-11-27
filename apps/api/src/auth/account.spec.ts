import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from 'argon2';
import type { UserRole } from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from './auth.service';
import type { AuthUser } from './auth.types';
import { issuedBeforePasswordChange } from './jwt.strategy';
import { TwoFactorService } from './two-factor/two-factor.service';

const PASSWORD = 'ChangeMe!Admin1';
const NEW_PASSWORD = 'A-much-longer-one-2026';

const me: AuthUser = {
  id: 'user-1',
  membershipId: 'mem-1',
  organisationId: 'org-1',
  organisationName: 'Demo',
  organisationBrandName: 'Demo',
  organisationCurrency: 'EUR',
  organisationCountry: 'CY',
  email: 'admin@demo.local',
  name: 'Admin',
  role: 'OWNER',
  customerId: null,
  twoFactorEnabled: true,
};

describe('account self-service', () => {
  const jwt = new JwtService({ secret: 'test-jwt-secret' });
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hash(PASSWORD);
  });

  function services() {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: me.id,
          email: me.email,
          name: me.name,
          passwordHash,
          twoFactorEnabled: true,
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
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      passwordReset: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    const audit = { record: jest.fn() };
    const auth = new AuthService(
      prisma as unknown as PrismaService,
      jwt,
      audit as unknown as AuditService,
      {} as TwoFactorService,
    );
    return { auth, prisma, audit };
  }

  it('renames the user, trimmed, and audits it', async () => {
    const { auth, prisma, audit } = services();
    const result = await auth.updateProfile(me, '  Chris Owner ');
    expect(result.name).toBe('Chris Owner');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: me.id },
      data: { name: 'Chris Owner' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      me,
      expect.objectContaining({ action: 'PROFILE_UPDATED' }),
    );
  });

  it('refuses a blank name', async () => {
    const { auth } = services();
    await expect(auth.updateProfile(me, '   ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a wrong current password and changes nothing', async () => {
    const { auth, prisma } = services();
    await expect(
      auth.changePassword(me, 'not-my-password', NEW_PASSWORD),
    ).rejects.toThrow('Your current password is not right.');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses the same password again', async () => {
    const { auth } = services();
    await expect(
      auth.changePassword(me, PASSWORD, PASSWORD),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sets the new password, ends other sessions and returns a session that still works', async () => {
    const { auth, prisma, audit } = services();
    const before = Math.floor(Date.now() / 1000) - 1;
    const result = await auth.changePassword(me, PASSWORD, NEW_PASSWORD);

    const data = prisma.user.update.mock.calls[0][0].data as {
      passwordHash: string;
      passwordChangedAt: Date;
    };
    expect(await verify(data.passwordHash, NEW_PASSWORD)).toBe(true);
    // A session from before the change is refused; the one handed back is not.
    expect(issuedBeforePasswordChange(before, data.passwordChangedAt)).toBe(
      true,
    );
    const payload = await jwt.verifyAsync<{ iat: number; sub: string }>(
      result.accessToken,
    );
    expect(payload.sub).toBe(me.id);
    expect(
      issuedBeforePasswordChange(payload.iat, data.passwordChangedAt),
    ).toBe(false);
    expect(prisma.passwordReset.updateMany).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      me,
      expect.objectContaining({ action: 'PASSWORD_CHANGED' }),
    );
  });
});
