import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import {
  INVITEABLE_STAFF_ROLES,
  ROLE_LABELS,
  type InviteableStaffRole,
  type UserRole,
} from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import { accessLock, lockedTransaction } from '../prisma/locked-transaction';
import { LicensingService } from '../licensing/licensing.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../integrations/notifications.service';
import { EmailTransport } from '../integrations/email-transport';
import type { AuthUser } from '../auth/auth.types';
import { presentOrganisation } from './organisation.view';
import { UpdateOrganisationDto } from './dto/organisation.dto';
import { InviteStaffDto, UpdateMemberDto } from './dto/member.dto';
import { createInviteToken, inviteExpiresAt } from '../auth/invite-token';
import { staffMembershipWasAccepted } from '../auth/accepted-membership';
import { assertWithinPlan, countStaffSeats } from '../tenancy/plan-policy';

const organisationInclude = {
  settings: true,
  subscription: true,
  features: true,
  closure: { select: { contractEndsAt: true, deleteAfter: true } },
} as const;

const memberSelect = {
  id: true,
  role: true,
  status: true,
  acceptedAt: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true, passwordHash: true } },
} as const;

/**
 * Hides the name on an existing account until its owner has accepted, so that
 * inviting an email address does not reveal who it belongs to.
 */
function presentMember<
  T extends {
    status: string;
    acceptedAt: Date | null;
    user: {
      id: string;
      name: string;
      email: string;
      passwordHash: string | null;
    };
  },
>(member: T) {
  const { acceptedAt, user, ...rest } = member;
  const { passwordHash, ...account } = user;
  const unconfirmed =
    member.status === 'INVITED' ||
    (member.status === 'DISABLED' && !acceptedAt);
  return {
    ...rest,
    user:
      unconfirmed && passwordHash
        ? { ...account, name: account.email }
        : account,
  };
}

@Injectable()
export class OrganisationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailTransport,
    @Optional() private readonly licensing?: LicensingService,
  ) {}

  /** The most team members the workspace's licence allows, or null for no limit. */
  private async seats(organisationId: string): Promise<number | null> {
    return (await this.licensing?.limit(organisationId, 'activeStaff')) ?? null;
  }

  async get(user: AuthUser) {
    const organisation = await this.prisma.organisation.findFirst({
      where: { id: user.organisationId },
      include: organisationInclude,
    });
    if (!organisation) {
      throw new NotFoundException('Organisation not found');
    }
    const view = presentOrganisation(organisation);
    // The end of the contract is the business's own matter, not its customers'.
    return user.role === 'CUSTOMER' ? { ...view, closure: null } : view;
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

  async listMembers(user: AuthUser) {
    const members = await this.prisma.organisationMembership.findMany({
      where: {
        organisationId: user.organisationId,
        role: { not: 'CUSTOMER' },
      },
      select: memberSelect,
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    return members.map(presentMember);
  }

  async inviteStaff(user: AuthUser, dto: InviteStaffDto) {
    const role = dto.role;
    if (!(INVITEABLE_STAFF_ROLES as readonly string[]).includes(role)) {
      throw new BadRequestException('That role cannot be invited');
    }
    const email = dto.email.toLowerCase().trim();
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Name is required');
    }

    const { token, tokenHash } = createInviteToken();
    const expiresAt = inviteExpiresAt();
    // Read before the transaction, so no network call is made while rows are locked.
    const seats = await this.seats(user.organisationId);
    const membership = await lockedTransaction(
      this.prisma,
      accessLock(user.organisationId),
      async (tx) => {
        let account = await tx.user.findUnique({ where: { email } });
        if (!account) {
          account = await tx.user.create({
            data: { email, name, passwordHash: null },
          });
        }

        const existing = await tx.organisationMembership.findUnique({
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

        const membership = await tx.organisationMembership.upsert({
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
        // Someone already invited holds their place. Checked after the write,
        // so a refusal rolls it back.
        if (existing?.status !== 'INVITED') {
          await assertWithinPlan(
            tx,
            user.organisationId,
            'activeStaff',
            () => countStaffSeats(tx, user.organisationId),
            undefined,
            seats,
          );
        }

        // The inviter may correct the name only while the account is nobody's yet:
        // no password, and no link to any other organisation.
        if (account.name !== name) {
          await tx.user.updateMany({
            where: {
              id: account.id,
              passwordHash: null,
              memberships: { every: { organisationId: user.organisationId } },
            },
            data: { name },
          });
        }

        await tx.staffInvite.updateMany({
          where: {
            organisationId: user.organisationId,
            userId: account.id,
            acceptedAt: null,
          },
          data: { expiresAt: new Date() },
        });

        await tx.staffInvite.create({
          data: {
            organisationId: user.organisationId,
            userId: account.id,
            createdById: user.id,
            role,
            tokenHash,
            expiresAt,
          },
        });

        return membership;
      },
    );

    const delivery = await this.emailStaffInvite(user, {
      to: email,
      role,
      token,
    });
    void this.audit.record(user, {
      action: 'STAFF_INVITED',
      entityType: 'OrganisationMembership',
      entityId: membership.id,
      metadata: { email, role, expiresAt: expiresAt.toISOString() },
    });

    const presented =
      await this.prisma.organisationMembership.findUniqueOrThrow({
        where: { id: membership.id },
        select: memberSelect,
      });
    return { member: presentMember(presented), expiresAt, ...delivery };
  }

  async updateMember(
    user: AuthUser,
    membershipId: string,
    dto: UpdateMemberDto,
  ) {
    if (dto.role === undefined && dto.status === undefined) {
      throw new BadRequestException('Nothing to update');
    }
    // Locked, so two Admins cannot each pass the last-Admin check at once.
    // Read before the transaction, so no network call is made while rows are locked.
    const seats = await this.seats(user.organisationId);
    const updated = await lockedTransaction(
      this.prisma,
      accessLock(user.organisationId),
      (tx) => this.applyMemberUpdate(tx, user, membershipId, dto, seats),
    );
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
    return presentMember(updated);
  }

  private async applyMemberUpdate(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    membershipId: string,
    dto: UpdateMemberDto,
    seats: number | null,
  ) {
    const member = await this.requireStaffMembership(user, membershipId, tx);
    if (member.userId === user.id && dto.status === 'DISABLED') {
      throw new BadRequestException('You cannot disable your own access');
    }
    if (member.userId === user.id && dto.role && dto.role !== 'ADMIN') {
      throw new BadRequestException('You cannot change your own role');
    }
    if (
      dto.role &&
      (INVITEABLE_STAFF_ROLES as readonly string[]).includes(dto.role) === false
    ) {
      throw new BadRequestException('That role is not allowed');
    }
    // A workspace always keeps one active Admin, so someone can manage it.
    const losesAdmin =
      member.role === 'ADMIN' &&
      member.status === 'ACTIVE' &&
      ((dto.role && dto.role !== 'ADMIN') || dto.status === 'DISABLED');
    if (losesAdmin) {
      const otherAdmins = await tx.organisationMembership.count({
        where: {
          organisationId: user.organisationId,
          id: { not: member.id },
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });
      if (otherAdmins === 0) {
        throw new BadRequestException(
          'This is the only active Admin. Make someone else an Admin first.',
        );
      }
    }

    if (dto.status === 'ACTIVE' && member.status !== 'ACTIVE') {
      const accepted = await staffMembershipWasAccepted(tx, {
        organisationId: user.organisationId,
        userId: member.userId,
        acceptedAt: member.acceptedAt,
      });
      if (!accepted) {
        throw new BadRequestException(
          'This person has not accepted an invite yet. Invite them again with the invite form.',
        );
      }
    }
    // Memberships made before acceptance was recorded were in use if they are
    // active and the account can sign in. Note that, so they can be re-enabled.
    let acceptedAt: Date | undefined;
    if (
      dto.status === 'DISABLED' &&
      member.status === 'ACTIVE' &&
      !member.acceptedAt
    ) {
      const account = await tx.user.findUnique({
        where: { id: member.userId },
        select: { passwordHash: true },
      });
      if (account?.passwordHash) acceptedAt = new Date();
    }

    const updated = await tx.organisationMembership.update({
      where: { id: member.id },
      data: {
        ...(dto.role ? { role: dto.role } : {}),
        ...(dto.status ? { status: dto.status } : {}),
        ...(acceptedAt ? { acceptedAt } : {}),
      },
      select: memberSelect,
    });
    if (dto.status === 'ACTIVE' && member.status === 'DISABLED') {
      await assertWithinPlan(
        tx,
        user.organisationId,
        'activeStaff',
        () => countStaffSeats(tx, user.organisationId),
        undefined,
        seats,
      );
    }
    if (dto.status === 'DISABLED') {
      // A link sent earlier must not undo this.
      await tx.staffInvite.updateMany({
        where: {
          organisationId: user.organisationId,
          userId: member.userId,
          acceptedAt: null,
        },
        data: { expiresAt: new Date() },
      });
    }
    return updated;
  }

  async resendInvite(user: AuthUser, membershipId: string) {
    const { token, tokenHash } = createInviteToken();
    const expiresAt = inviteExpiresAt();
    const member = await lockedTransaction(
      this.prisma,
      accessLock(user.organisationId),
      async (tx) => {
        const member = await this.requireStaffMembership(
          user,
          membershipId,
          tx,
        );
        if (member.status !== 'INVITED') {
          throw new BadRequestException('Only pending invites can be resent');
        }
        if (
          !(INVITEABLE_STAFF_ROLES as readonly string[]).includes(member.role)
        ) {
          throw new BadRequestException('That role cannot be re-invited');
        }

        await tx.staffInvite.updateMany({
          where: {
            organisationId: user.organisationId,
            userId: member.userId,
            acceptedAt: null,
          },
          data: { expiresAt: new Date() },
        });
        await tx.staffInvite.create({
          data: {
            organisationId: user.organisationId,
            userId: member.userId,
            createdById: user.id,
            role: member.role as InviteableStaffRole,
            tokenHash,
            expiresAt,
          },
        });
        return member;
      },
    );
    const account = await this.prisma.user.findUnique({
      where: { id: member.userId },
      select: { passwordHash: true },
    });
    const delivery = await this.emailStaffInvite(user, {
      to: member.user.email,
      role: member.role,
      token,
    });
    void this.audit.record(user, {
      action: 'STAFF_INVITE_RESENT',
      entityType: 'OrganisationMembership',
      entityId: member.id,
      metadata: {
        email: member.user.email,
        expiresAt: expiresAt.toISOString(),
      },
    });
    return {
      member: presentMember({
        ...member,
        user: { ...member.user, passwordHash: account?.passwordHash ?? null },
      }),
      expiresAt,
      ...delivery,
    };
  }

  /**
   * The link goes to the invitee's mailbox and nowhere else, so accepting it
   * shows they own the address. The sender sees it only in local development.
   */
  private async emailStaffInvite(
    user: AuthUser,
    invite: { to: string; role: UserRole; token: string },
  ): Promise<{ emailSent: boolean; inviteUrl?: string }> {
    const inviteUrl = `${this.webOrigin()}/invite/${invite.token}`;
    const emailSent = await this.notifications.sendStaffInvite(
      invite.to,
      {
        brandName: user.organisationBrandName,
        roleLabel: ROLE_LABELS[invite.role],
        inviteUrl,
      },
      user.organisationId,
    );
    return {
      emailSent,
      ...(this.email.localDelivery() ? { inviteUrl } : {}),
    };
  }

  private async requireStaffMembership(
    user: AuthUser,
    membershipId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const member = await db.organisationMembership.findFirst({
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
        acceptedAt: true,
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
