import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  INVITEABLE_STAFF_ROLES,
  type InviteableStaffRole,
  type UserRole,
} from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { presentOrganisation } from './organisation.view';
import { UpdateOrganisationDto } from './dto/organisation.dto';
import { InviteStaffDto, UpdateMemberDto } from './dto/member.dto';
import {
  createInviteToken,
  inviteExpiresAt,
} from '../auth/invite-token';

const organisationInclude = {
  settings: true,
  subscription: true,
  features: true,
} as const;

const memberSelect = {
  id: true,
  role: true,
  status: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true } },
} as const;

@Injectable()
export class OrganisationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
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
      select: memberSelect,
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async inviteStaff(user: AuthUser, dto: InviteStaffDto) {
    const role = dto.role as InviteableStaffRole;
    if (!(INVITEABLE_STAFF_ROLES as readonly string[]).includes(role)) {
      throw new BadRequestException('That role cannot be invited');
    }
    const email = dto.email.toLowerCase().trim();
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Name is required');
    }

    let account = await this.prisma.user.findUnique({ where: { email } });
    if (!account) {
      account = await this.prisma.user.create({
        data: { email, name, passwordHash: null },
      });
    }

    const existing = await this.prisma.organisationMembership.findUnique({
      where: {
        organisationId_userId: {
          organisationId: user.organisationId,
          userId: account.id,
        },
      },
    });
    if (existing?.role === 'CUSTOMER') {
      throw new BadRequestException(
        'That email already belongs to a customer portal account in this organisation',
      );
    }
    if (existing?.status === 'ACTIVE') {
      throw new BadRequestException('That person is already on the team');
    }

    const membership = await this.prisma.organisationMembership.upsert({
      where: {
        organisationId_userId: {
          organisationId: user.organisationId,
          userId: account.id,
        },
      },
      update: {
        role,
        status: 'INVITED',
        customerId: null,
      },
      create: {
        organisationId: user.organisationId,
        userId: account.id,
        role,
        status: 'INVITED',
      },
      select: memberSelect,
    });

    if (account.name !== name) {
      await this.prisma.user.update({
        where: { id: account.id },
        data: { name },
      });
    }

    await this.prisma.staffInvite.updateMany({
      where: {
        organisationId: user.organisationId,
        userId: account.id,
        acceptedAt: null,
      },
      data: { expiresAt: new Date() },
    });

    const { token, tokenHash } = createInviteToken();
    const expiresAt = inviteExpiresAt();
    await this.prisma.staffInvite.create({
      data: {
        organisationId: user.organisationId,
        userId: account.id,
        createdById: user.id,
        role,
        tokenHash,
        expiresAt,
      },
    });

    const inviteUrl = `${this.webOrigin()}/invite/${token}`;
    void this.audit.record(user, {
      action: 'STAFF_INVITED',
      entityType: 'OrganisationMembership',
      entityId: membership.id,
      metadata: { email, role, expiresAt: expiresAt.toISOString() },
    });

    const presented = await this.prisma.organisationMembership.findUniqueOrThrow(
      {
        where: { id: membership.id },
        select: memberSelect,
      },
    );
    return { member: presented, inviteUrl, expiresAt };
  }

  async updateMember(
    user: AuthUser,
    membershipId: string,
    dto: UpdateMemberDto,
  ) {
    if (dto.role === undefined && dto.status === undefined) {
      throw new BadRequestException('Nothing to update');
    }
    const member = await this.requireStaffMembership(user, membershipId);
    if (member.userId === user.id && dto.status === 'DISABLED') {
      throw new BadRequestException('You cannot disable your own access');
    }
    if (member.role === 'OWNER') {
      throw new ForbiddenException('Owner membership cannot be changed here');
    }
    if (dto.role && (INVITEABLE_STAFF_ROLES as readonly string[]).includes(dto.role) === false) {
      throw new BadRequestException('That role is not allowed');
    }

    const updated = await this.prisma.organisationMembership.update({
      where: { id: member.id },
      data: {
        ...(dto.role ? { role: dto.role as UserRole } : {}),
        ...(dto.status ? { status: dto.status } : {}),
      },
      select: memberSelect,
    });
    void this.audit.record(user, {
      action: 'STAFF_MEMBERSHIP_UPDATED',
      entityType: 'OrganisationMembership',
      entityId: updated.id,
      metadata: {
        role: dto.role,
        status: dto.status,
        userId: updated.user.id,
      },
    });
    return updated;
  }

  async resendInvite(user: AuthUser, membershipId: string) {
    const member = await this.requireStaffMembership(user, membershipId);
    if (member.status !== 'INVITED') {
      throw new BadRequestException('Only pending invites can be resent');
    }
    if (
      !(INVITEABLE_STAFF_ROLES as readonly string[]).includes(
        member.role as InviteableStaffRole,
      )
    ) {
      throw new BadRequestException('That role cannot be re-invited');
    }

    await this.prisma.staffInvite.updateMany({
      where: {
        organisationId: user.organisationId,
        userId: member.userId,
        acceptedAt: null,
      },
      data: { expiresAt: new Date() },
    });
    const { token, tokenHash } = createInviteToken();
    const expiresAt = inviteExpiresAt();
    await this.prisma.staffInvite.create({
      data: {
        organisationId: user.organisationId,
        userId: member.userId,
        createdById: user.id,
        role: member.role as InviteableStaffRole,
        tokenHash,
        expiresAt,
      },
    });
    const inviteUrl = `${this.webOrigin()}/invite/${token}`;
    void this.audit.record(user, {
      action: 'STAFF_INVITE_RESENT',
      entityType: 'OrganisationMembership',
      entityId: member.id,
      metadata: { email: member.user.email, expiresAt: expiresAt.toISOString() },
    });
    return { member, inviteUrl, expiresAt };
  }

  private async requireStaffMembership(user: AuthUser, membershipId: string) {
    const member = await this.prisma.organisationMembership.findFirst({
      where: {
        id: membershipId,
        organisationId: user.organisationId,
        role: { not: 'CUSTOMER' },
      },
      select: {
        id: true,
        role: true,
        status: true,
        userId: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
    if (!member) {
      throw new NotFoundException('Team member not found');
    }
    return member;
  }

  private webOrigin() {
    return this.config
      .get<string>('WEB_ORIGIN', 'http://localhost:5173')
      .replace(/\/$/, '');
  }
}
