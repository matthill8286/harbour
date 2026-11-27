import { BadRequestException } from '@nestjs/common';
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
    role: 'ADMIN',
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
      updateMany: jest.fn(),
    },
    organisationMembership: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
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
        role: 'STAFF',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps one active Admin: the last one cannot be made Staff', async () => {
    prisma.organisationMembership.findFirst.mockResolvedValue({
      id: 'mem-other',
      role: 'ADMIN',
      status: 'ACTIVE',
      userId: 'user-2',
      createdAt: new Date(),
      user: { id: 'user-2', name: 'Alex', email: 'alex@example.com' },
    });
    prisma.organisationMembership.count.mockResolvedValue(0);

    await expect(
      service.updateMember(actor, 'mem-other', { role: 'STAFF' }),
    ).rejects.toThrow(/only active Admin/);
    await expect(
      service.updateMember(actor, 'mem-other', { status: 'DISABLED' }),
    ).rejects.toThrow(/only active Admin/);
    expect(prisma.organisationMembership.update).not.toHaveBeenCalled();
  });

  it('lets an Admin be made Staff while another Admin remains', async () => {
    prisma.organisationMembership.findFirst.mockResolvedValue({
      id: 'mem-other',
      role: 'ADMIN',
      status: 'ACTIVE',
      userId: 'user-2',
      createdAt: new Date(),
      user: { id: 'user-2', name: 'Alex', email: 'alex@example.com' },
    });
    prisma.organisationMembership.count.mockResolvedValue(1);
    prisma.organisationMembership.update.mockResolvedValue({
      id: 'mem-other',
      role: 'STAFF',
      status: 'ACTIVE',
      acceptedAt: null,
      user: { id: 'user-2' },
    });

    await service.updateMember(actor, 'mem-other', { role: 'STAFF' });
    expect(prisma.organisationMembership.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: { not: 'mem-other' },
        role: { in: ['ADMIN', 'OWNER'] },
        status: 'ACTIVE',
      }),
    });
    expect(prisma.organisationMembership.update).toHaveBeenCalled();
  });

  it('does not let you demote yourself', async () => {
    prisma.organisationMembership.findFirst.mockResolvedValue({
      id: 'mem-owner',
      role: 'ADMIN',
      status: 'ACTIVE',
      userId: actor.id,
      createdAt: new Date(),
      user: { id: actor.id, name: 'Owner', email: actor.email },
    });
    await expect(
      service.updateMember(actor, 'mem-owner', { role: 'STAFF' }),
    ).rejects.toThrow(/your own role/);
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
