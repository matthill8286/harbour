import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrganisationsService } from './organisations.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';

describe('OrganisationsService staff invites', () => {
  const actor: AuthUser = {
    id: 'user-owner',
    email: 'owner@example.com',
    name: 'Owner',
    role: 'OWNER',
    organisationId: 'org-1',
    membershipId: 'mem-owner',
    customerId: null,
    organisationName: 'Demo',
    organisationBrandName: 'Demo',
    organisationCurrency: 'EUR',
    organisationCountry: 'CY',
    twoFactorEnabled: true,
  };

  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    organisationMembership: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    staffInvite: {
      updateMany: jest.fn(),
      create: jest.fn(),
    },
  };

  const audit = { record: jest.fn() };
  const config = {
    get: (_key: string, fallback?: string) =>
      fallback ?? 'http://localhost:5173',
  };

  const service = new OrganisationsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    config as ConfigService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a staff invite and returns a one-time URL', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-new',
      email: 'alex@example.com',
      name: 'Alex',
    });
    prisma.organisationMembership.findUnique.mockResolvedValue(null);
    prisma.organisationMembership.upsert.mockResolvedValue({
      id: 'mem-1',
      role: 'STAFF',
      status: 'INVITED',
      createdAt: new Date(),
      user: { id: 'user-new', name: 'Alex', email: 'alex@example.com' },
    });
    prisma.organisationMembership.findUniqueOrThrow.mockResolvedValue({
      id: 'mem-1',
      role: 'STAFF',
      status: 'INVITED',
      createdAt: new Date(),
      user: { id: 'user-new', name: 'Alex', email: 'alex@example.com' },
    });
    prisma.staffInvite.updateMany.mockResolvedValue({ count: 0 });
    prisma.staffInvite.create.mockResolvedValue({ id: 'inv-1' });

    const result = await service.inviteStaff(actor, {
      email: 'Alex@example.com',
      name: 'Alex',
      role: 'STAFF',
    });

    expect(result.inviteUrl).toMatch(/^http:\/\/localhost:5173\/invite\//);
    expect(prisma.staffInvite.create).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalled();
  });

  it('rejects inviting an active teammate', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'alex@example.com',
      name: 'Alex',
    });
    prisma.organisationMembership.findUnique.mockResolvedValue({
      id: 'mem-2',
      role: 'STAFF',
      status: 'ACTIVE',
    });

    await expect(
      service.inviteStaff(actor, {
        email: 'alex@example.com',
        name: 'Alex',
        role: 'VIEWER',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks changing the owner membership', async () => {
    prisma.organisationMembership.findFirst.mockResolvedValue({
      id: 'mem-owner',
      role: 'OWNER',
      status: 'ACTIVE',
      userId: 'user-owner',
      createdAt: new Date(),
      user: { id: 'user-owner', name: 'Owner', email: 'owner@example.com' },
    });

    await expect(
      service.updateMember(actor, 'mem-owner', { role: 'ADMIN' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks disabling yourself', async () => {
    prisma.organisationMembership.findFirst.mockResolvedValue({
      id: 'mem-self',
      role: 'ADMIN',
      status: 'ACTIVE',
      userId: actor.id,
      createdAt: new Date(),
      user: { id: actor.id, name: 'Owner', email: actor.email },
    });

    await expect(
      service.updateMember(actor, 'mem-self', { status: 'DISABLED' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
