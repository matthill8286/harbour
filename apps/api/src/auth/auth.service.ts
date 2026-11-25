import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from 'argon2';
import { isStaffRole, ROLE_LABELS, type UserRole } from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import { pickActiveMembership } from '../tenancy/membership';
import type { AuthUser } from './auth.types';
import { buildAuthUser } from './auth-user';
import { LoginDto } from './dto/login.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { hashInviteToken } from './invite-token';
import { AuditService } from '../audit/audit.service';
import { TwoFactorService } from './two-factor/two-factor.service';

type PortalInviteLoaded = {
  kind: 'portal';
  id: string;
  userId: string;
  organisationId: string;
  customerId: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  user: { email: string; name: string };
  customer: { firstName: string; lastName: string };
  organisation: {
    name: string;
    status: string;
    settings?: { brandName: string | null } | null;
  };
};

type StaffInviteLoaded = {
  kind: 'staff';
  id: string;
  userId: string;
  organisationId: string;
  role: UserRole;
  expiresAt: Date;
  acceptedAt: Date | null;
  user: { email: string; name: string };
  organisation: {
    name: string;
    status: string;
    settings?: { brandName: string | null } | null;
  };
};

type LoadedInvite = PortalInviteLoaded | StaffInviteLoaded;

type SessionMembership = {
  id: string;
  organisationId: string;
  role: AuthUser['role'];
  customerId: string | null;
  organisation: {
    name: string;
    currency?: string;
    country?: string;
    settings?: { brandName: string | null } | null;
  };
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: {
        memberships: {
          include: { organisation: { include: { settings: true } } },
        },
      },
    });
    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const valid = await verify(user.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const membership = pickActiveMembership(user.memberships);
    if (!membership) {
      throw new UnauthorizedException(
        'No active organisation for this account',
      );
    }
    return this.completeSignIn(user, membership);
  }

  /** Second step for accounts with two-factor on: a valid code turns the challenge into a session. */
  async completeTwoFactorChallenge(input: {
    challengeToken: string;
    code?: string;
    backupCode?: string;
  }) {
    const challenge = await this.twoFactor.readChallenge(input.challengeToken);
    await this.twoFactor.verifySignIn(challenge.sub, input);
    const user = await this.prisma.user.findUnique({
      where: { id: challenge.sub },
      include: {
        memberships: {
          include: { organisation: { include: { settings: true } } },
        },
      },
    });
    const membership = user?.memberships.find(
      (item) =>
        item.id === challenge.membershipId &&
        item.status === 'ACTIVE' &&
        item.organisation.status === 'ACTIVE',
    );
    if (!user || !membership) {
      throw new UnauthorizedException(
        'No active organisation for this account',
      );
    }
    return this.issueSession(user, membership);
  }

  async previewInvite(token: string) {
    const invite = await this.loadInvite(token);
    const organisationBrandName =
      invite.organisation.settings?.brandName?.trim() ||
      invite.organisation.name;
    if (invite.kind === 'portal') {
      return {
        kind: 'portal' as const,
        email: invite.user.email,
        firstName: invite.customer.firstName,
        lastName: invite.customer.lastName,
        organisationName: invite.organisation.name,
        organisationBrandName,
        expiresAt: invite.expiresAt,
      };
    }
    const [firstName, ...rest] = invite.user.name.trim().split(/\s+/);
    return {
      kind: 'staff' as const,
      email: invite.user.email,
      firstName: firstName || invite.user.name,
      lastName: rest.join(' '),
      role: invite.role,
      roleLabel: ROLE_LABELS[invite.role],
      organisationName: invite.organisation.name,
      organisationBrandName,
      expiresAt: invite.expiresAt,
    };
  }

  async acceptInvite(token: string, dto: AcceptInviteDto) {
    const invite = await this.loadInvite(token);
    if (invite.kind === 'portal') {
      return this.acceptPortalInvite(invite, dto.password);
    }
    return this.acceptStaffInvite(invite, dto.password);
  }

  private async acceptPortalInvite(
    invite: PortalInviteLoaded,
    password: string,
  ) {
    const passwordHash = await hash(password);
    const acceptedAt = new Date();
    const user = await this.prisma.$transaction(async (tx) => {
      await tx.portalInvite.update({
        where: { id: invite.id },
        data: { acceptedAt },
      });
      await tx.portalInvite.updateMany({
        where: {
          userId: invite.userId,
          acceptedAt: null,
          id: { not: invite.id },
        },
        data: { expiresAt: acceptedAt },
      });
      await tx.organisationMembership.updateMany({
        where: {
          userId: invite.userId,
          organisationId: invite.organisationId,
          role: 'CUSTOMER',
        },
        data: { status: 'ACTIVE' },
      });
      return tx.user.update({
        where: { id: invite.userId },
        data: {
          passwordHash,
          name: `${invite.customer.firstName} ${invite.customer.lastName}`.trim(),
        },
        include: {
          memberships: {
            include: { organisation: { include: { settings: true } } },
          },
        },
      });
    });
    const membership = user.memberships.find(
      (item) =>
        item.organisationId === invite.organisationId &&
        item.role === 'CUSTOMER',
    );
    if (!membership) {
      throw new UnauthorizedException('No customer membership for this invite');
    }
    void this.audit.record(
      buildAuthUser({
        id: user.id,
        email: user.email,
        name: user.name,
        membership,
      }),
      {
        action: 'PORTAL_ACCESS_ACCEPTED',
        entityType: 'Customer',
        entityId: invite.customerId,
        metadata: { customerId: invite.customerId },
      },
    );
    return this.completeSignIn(user, membership);
  }

  private async acceptStaffInvite(invite: StaffInviteLoaded, password: string) {
    if (!isStaffRole(invite.role) || invite.role === 'CUSTOMER') {
      throw new BadRequestException('Invalid staff invite role');
    }
    const passwordHash = await hash(password);
    const acceptedAt = new Date();
    const user = await this.prisma.$transaction(async (tx) => {
      await tx.staffInvite.update({
        where: { id: invite.id },
        data: { acceptedAt },
      });
      await tx.staffInvite.updateMany({
        where: {
          userId: invite.userId,
          acceptedAt: null,
          id: { not: invite.id },
        },
        data: { expiresAt: acceptedAt },
      });
      await tx.organisationMembership.updateMany({
        where: {
          userId: invite.userId,
          organisationId: invite.organisationId,
          role: { not: 'CUSTOMER' },
        },
        data: { status: 'ACTIVE', role: invite.role },
      });
      return tx.user.update({
        where: { id: invite.userId },
        data: { passwordHash },
        include: {
          memberships: {
            include: { organisation: { include: { settings: true } } },
          },
        },
      });
    });
    const membership = user.memberships.find(
      (item) =>
        item.organisationId === invite.organisationId &&
        item.role !== 'CUSTOMER' &&
        item.status === 'ACTIVE',
    );
    if (!membership) {
      throw new UnauthorizedException('No staff membership for this invite');
    }
    void this.audit.record(
      buildAuthUser({
        id: user.id,
        email: user.email,
        name: user.name,
        membership,
      }),
      {
        action: 'STAFF_INVITE_ACCEPTED',
        entityType: 'OrganisationMembership',
        entityId: membership.id,
        metadata: { role: invite.role },
      },
    );
    return this.completeSignIn(user, membership);
  }

  /** An account with two-factor on gets a challenge, never a session, from its password alone. */
  private async completeSignIn(
    user: {
      id: string;
      email: string;
      name: string;
      twoFactorEnabled: boolean;
    },
    membership: SessionMembership,
  ) {
    if (user.twoFactorEnabled) {
      return this.twoFactor.createChallenge(user.id, membership.id);
    }
    return this.issueSession(user, membership);
  }

  private async issueSession(
    user: {
      id: string;
      email: string;
      name: string;
      twoFactorEnabled?: boolean;
    },
    membership: SessionMembership,
  ) {
    const authUser = buildAuthUser({
      id: user.id,
      email: user.email,
      name: user.name,
      twoFactorEnabled: user.twoFactorEnabled,
      membership,
    });
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      membershipId: membership.id,
    });
    return { accessToken, user: authUser };
  }

  private async loadInvite(token: string): Promise<LoadedInvite> {
    if (!token) {
      throw new NotFoundException('Invite not found');
    }
    const tokenHash = hashInviteToken(token);
    const portal = await this.prisma.portalInvite.findUnique({
      where: { tokenHash },
      include: {
        customer: true,
        organisation: { include: { settings: true } },
        user: true,
      },
    });
    if (portal) {
      this.assertInviteUsable(portal);
      return { kind: 'portal', ...portal };
    }

    const staff = await this.prisma.staffInvite.findUnique({
      where: { tokenHash },
      include: {
        organisation: { include: { settings: true } },
        user: true,
      },
    });
    if (!staff) {
      throw new NotFoundException('Invite not found');
    }
    this.assertInviteUsable(staff);
    return { kind: 'staff', ...staff };
  }

  private assertInviteUsable(invite: {
    acceptedAt: Date | null;
    expiresAt: Date;
    organisation: { status: string };
  }) {
    if (invite.acceptedAt) {
      throw new BadRequestException(
        'This invite has already been used. Sign in instead.',
      );
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      throw new GoneException(
        'This invite has expired. Ask your team for a new link.',
      );
    }
    if (invite.organisation.status !== 'ACTIVE') {
      throw new UnauthorizedException('This organisation is not active');
    }
  }
}
