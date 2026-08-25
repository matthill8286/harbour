import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { presentOrganisation } from './organisation.view';
import { UpdateOrganisationDto } from './dto/organisation.dto';

const organisationInclude = {
  settings: true,
  subscription: true,
  features: true,
} as const;

@Injectable()
export class OrganisationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(user: AuthUser) {
    const organisation = await this.prisma.organisation.findFirst({
      where: { id: user.organisationId },
      include: organisationInclude,
    });
    if (!organisation) {
      throw new NotFoundException('Organisation not found');
    }
    return presentOrganisation(organisation);
  }

  async update(user: AuthUser, dto: UpdateOrganisationDto) {
    await this.get(user);
    const organisation = await this.prisma.$transaction(async (tx) => {
      if (dto.brandName !== undefined) {
        await tx.organisationSettings.upsert({
          where: { organisationId: user.organisationId },
          update: { brandName: dto.brandName.trim() || null },
          create: {
            organisationId: user.organisationId,
            brandName: dto.brandName.trim() || null,
          },
        });
      }
      return tx.organisation.update({
        where: { id: user.organisationId },
        data: {
          name: dto.name?.trim(),
          legalName: dto.legalName?.trim(),
          timezone: dto.timezone?.trim(),
          currency: dto.currency?.trim().toUpperCase(),
          country: dto.country?.trim().toUpperCase(),
        },
        include: organisationInclude,
      });
    });
    void this.audit.record(user, {
      action: 'ORGANISATION_UPDATED',
      entityType: 'Organisation',
      entityId: organisation.id,
      metadata: { fields: Object.keys(dto) },
    });
    return presentOrganisation(organisation);
  }

  listMembers(user: AuthUser) {
    return this.prisma.organisationMembership.findMany({
      where: {
        organisationId: user.organisationId,
        role: { not: 'CUSTOMER' },
      },
      select: {
        id: true,
        role: true,
        status: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
  }
}
