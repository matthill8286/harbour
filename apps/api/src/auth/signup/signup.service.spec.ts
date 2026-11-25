import { ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { verify } from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SignupService } from './signup.service';
import { organisationSlug } from './signup';

describe('organisationSlug', () => {
  it('makes a readable, unique slug', () => {
    expect(organisationSlug('Ánna’s Car Imports Ltd.')).toMatch(
      /^anna-s-car-imports-ltd-[0-9a-f]{6}$/,
    );
    expect(organisationSlug('!!!')).toMatch(/^workspace-[0-9a-f]{6}$/);
    expect(organisationSlug('Same')).not.toBe(organisationSlug('Same'));
  });
});

describe('SignupService', () => {
  const jwt = new JwtService({ secret: 'test-jwt-secret' });
  const audit = { record: jest.fn() };

  function setup(existingUser: object | null = null) {
    const tx = {
      organisation: {
        create: jest.fn().mockResolvedValue({ id: 'org-new' }),
      },
      user: {
        create: jest.fn(({ data }: { data: Record<string, string> }) =>
          Promise.resolve({ id: 'user-new', ...data }),
        ),
      },
      organisationMembership: {
        create: jest.fn().mockResolvedValue({
          id: 'mem-new',
          organisationId: 'org-new',
          role: 'OWNER',
          customerId: null,
          organisation: {
            name: 'Anna Imports',
            currency: 'EUR',
            country: 'CY',
            settings: { brandName: 'Anna Imports' },
          },
        }),
      },
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(existingUser) },
      $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
    };
    const service = new SignupService(
      prisma as unknown as PrismaService,
      jwt,
      audit as unknown as AuditService,
    );
    return { service, prisma, tx };
  }

  const dto = {
    organisationName: '  Anna Imports ',
    name: ' Anna ',
    email: ' Anna@Example.com ',
    password: 'a-long-password',
  };

  it('creates a trial workspace with the new user as owner and signs them in', async () => {
    const { service, tx } = setup();
    const result = await service.signup(dto);

    const org = tx.organisation.create.mock.calls[0][0].data;
    expect(org.name).toBe('Anna Imports');
    expect(org.slug).toMatch(/^anna-imports-[0-9a-f]{6}$/);
    expect(org.subscription).toEqual({
      create: { plan: 'STARTER', status: 'TRIAL' },
    });
    expect(org.features.create).toEqual([
      { flag: 'GPS_TRACKING', enabled: true },
      { flag: 'CUSTOMER_PORTAL', enabled: true },
    ]);

    const user = tx.user.create.mock.calls[0][0].data;
    expect(user.email).toBe('anna@example.com');
    expect(user.name).toBe('Anna');
    expect(await verify(user.passwordHash, 'a-long-password')).toBe(true);

    expect(
      tx.organisationMembership.create.mock.calls[0][0].data,
    ).toMatchObject({
      organisationId: 'org-new',
      userId: 'user-new',
      role: 'OWNER',
      status: 'ACTIVE',
    });
    expect(result.user).toMatchObject({
      id: 'user-new',
      role: 'OWNER',
      organisationId: 'org-new',
      organisationBrandName: 'Anna Imports',
    });
    expect(jwt.decode(result.accessToken)).toMatchObject({
      sub: 'user-new',
      membershipId: 'mem-new',
    });
  });

  it('refuses an email that already has an account', async () => {
    const { service, prisma } = setup({ id: 'someone' });
    await expect(service.signup(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('turns a simultaneous duplicate sign-up into the same conflict', async () => {
    const { service, tx } = setup();
    tx.user.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(service.signup(dto)).rejects.toBeInstanceOf(ConflictException);
  });
});
