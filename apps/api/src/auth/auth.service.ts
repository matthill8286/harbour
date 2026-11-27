import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Prisma } from '@prisma/client';
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
import { issuedBeforePasswordChange } from './jwt.strategy';
import { RateLimiter } from '../rate-limit/rate-limiter';

/** The same minimum as resetting or changing a password. */
const NEW_PASSWORD_MIN_LENGTH = 10;

/**
 * Checked when there is no account to check, so that an unknown email takes as
 * long to refuse as a wrong password.
 */
let absentAccountHash: Promise<string> | undefined;
const hashForAbsentAccount = () =>
  (absentAccountHash ??= hash(randomBytes(32).toString('hex')));

type InviteAccount = {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  twoFactorEnabled: boolean;
};

function unusedInvite(id: string, now: Date) {
  return { id, acceptedAt: null, expiresAt: { gt: now } };
}

/** Only this organisation's other links: another organisation's invite stays good. */
function otherPendingInvites(invite: {
  id: string;
  userId: string;
  organisationId: string;
}) {
  return {
    userId: invite.userId,
    organisationId: invite.organisationId,
    acceptedAt: null,
    id: { not: invite.id },
  };
}

function assertClaimed(count: number) {
  if (count === 0) {
    throw new BadRequestException(
      'This invite can no longer be used. Ask your team for a new link.',
    );
  }
}

/** Gives a new account its first password, as long as nobody else just did. */
async function claimAccount(
  tx: Prisma.TransactionClient,
  invite: { userId: string; organisationId: string },
  data: { passwordHash: string; name?: string },
) {
  const claimed = await tx.user.updateMany({
    where: { id: invite.userId, passwordHash: null },
    data,
  });
  if (claimed.count === 0) {
    throw new BadRequestException(
      'This account already has a password. Reload this page, then accept with that password.',
    );
  }
  // Nobody could have accepted elsewhere without a password. An active
  // membership found here was switched on by someone else, so it goes back to
  // waiting for an invite.
  await tx.organisationMembership.updateMany({
    where: {
      userId: invite.userId,
      organisationId: { not: invite.organisationId },
      status: 'ACTIVE',
    },
    data: { status: 'INVITED', acceptedAt: null },
  });
}

type PortalInviteLoaded = {
  kind: 'portal';
  id: string;
  userId: string;
  organisationId: string;
  customerId: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  user: InviteAccount;
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
  user: InviteAccount;
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
  role: UserRole;
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
    private readonly limiter: RateLimiter,
  ) {}

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    // Taken before the account is looked up, so it says nothing about it.
    this.limiter.consume('passwordAccount', email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          include: { organisation: { include: { settings: true } } },
        },
      },
    });
    const valid = await verify(
      user?.passwordHash ?? (await hashForAbsentAccount()),
      dto.password,
    );
    if (!user?.passwordHash || !valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    this.limiter.reset('passwordAccount', email);
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
    this.limiter.consume('twoFactorAccount', challenge.sub);
    await this.twoFactor.verifySignIn(challenge.sub, input);
    this.limiter.reset('twoFactorAccount', challenge.sub);
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
    if (issuedBeforePasswordChange(challenge.iat, user.passwordChangedAt)) {
      throw new UnauthorizedException(
        'This sign-in has expired. Enter your email and password again.',
      );
    }
    return this.issueSession(user, membership);
  }

  async previewInvite(token: string) {
    const invite = await this.loadInvite(token);
    this.limiter.consume('invitePreviewAccount', invite.userId);
    const organisationBrandName =
      invite.organisation.settings?.brandName?.trim() ||
      invite.organisation.name;
    if (invite.kind === 'portal') {
      return {
        kind: 'portal' as const,
        email: invite.user.email,
        existingAccount: Boolean(invite.user.passwordHash),
        firstName: invite.customer.firstName,
        lastName: invite.customer.lastName,
        organisationName: invite.organisation.name,
        organisationBrandName,
        expiresAt: invite.expiresAt,
      };
    }
    // The name on an existing account is not the inviter's to see.
    const existingAccount = Boolean(invite.user.passwordHash);
    const name = existingAccount ? '' : invite.user.name;
    const [firstName, ...rest] = name.trim().split(/\s+/);
    return {
      kind: 'staff' as const,
      email: invite.user.email,
      existingAccount,
      firstName: firstName || name,
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
    this.limiter.consume('inviteAcceptAccount', invite.userId);
    if (invite.kind === 'portal') {
      return this.acceptPortalInvite(invite, dto);
    }
    return this.acceptStaffInvite(invite, dto);
  }

  private async acceptPortalInvite(
    invite: PortalInviteLoaded,
    dto: AcceptInviteDto,
  ) {
    const proof = await this.proveInvitee(invite.user, dto);
    const acceptedAt = new Date();
    const user = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.portalInvite.updateMany({
        where: unusedInvite(invite.id, acceptedAt),
        data: { acceptedAt },
      });
      assertClaimed(claimed.count);
      await tx.portalInvite.updateMany({
        where: otherPendingInvites(invite),
        data: { expiresAt: acceptedAt },
      });
      const joined = await tx.organisationMembership.updateMany({
        where: {
          userId: invite.userId,
          organisationId: invite.organisationId,
          customerId: invite.customerId,
          role: 'CUSTOMER',
          status: { in: ['INVITED', 'ACTIVE'] },
        },
        data: { status: 'ACTIVE', acceptedAt },
      });
      assertClaimed(joined.count);
      if (proof.newPasswordHash) {
        await claimAccount(tx, invite, {
          passwordHash: proof.newPasswordHash,
          name: `${invite.customer.firstName} ${invite.customer.lastName}`.trim(),
        });
      }
      return tx.user.findUniqueOrThrow({
        where: { id: invite.userId },
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
    // proveInvitee has already checked any two-factor code.
    return this.issueSession(user, membership);
  }

  private async acceptStaffInvite(
    invite: StaffInviteLoaded,
    dto: AcceptInviteDto,
  ) {
    if (!isStaffRole(invite.role)) {
      throw new BadRequestException('Invalid staff invite role');
    }
    const proof = await this.proveInvitee(invite.user, dto);
    const acceptedAt = new Date();
    const user = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.staffInvite.updateMany({
        where: unusedInvite(invite.id, acceptedAt),
        data: { acceptedAt },
      });
      assertClaimed(claimed.count);
      await tx.staffInvite.updateMany({
        where: otherPendingInvites(invite),
        data: { expiresAt: acceptedAt },
      });
      const joined = await tx.organisationMembership.updateMany({
        where: {
          userId: invite.userId,
          organisationId: invite.organisationId,
          role: { not: 'CUSTOMER' },
          status: { in: ['INVITED', 'ACTIVE'] },
        },
        data: { status: 'ACTIVE', role: invite.role, acceptedAt },
      });
      assertClaimed(joined.count);
      if (proof.newPasswordHash) {
        await claimAccount(tx, invite, {
          passwordHash: proof.newPasswordHash,
        });
      }
      return tx.user.findUniqueOrThrow({
        where: { id: invite.userId },
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
    return this.issueSession(user, membership);
  }

  /**
   * An account that already has a password belongs to someone, so the invite
   * link is not enough: they enter that password, and a two-factor code where it
   * is on. Nothing about the account changes. Only an account without a password
   * takes the one typed here.
   */
  private async proveInvitee(
    account: InviteAccount,
    dto: AcceptInviteDto,
  ): Promise<{ newPasswordHash: string | null }> {
    if (!account.passwordHash) {
      if (dto.password.length < NEW_PASSWORD_MIN_LENGTH) {
        throw new BadRequestException(
          `Use at least ${NEW_PASSWORD_MIN_LENGTH} characters for your password.`,
        );
      }
      return { newPasswordHash: await hash(dto.password) };
    }
    // The same count as sign-in, so an invite is not a second way to guess.
    this.limiter.consume('passwordAccount', account.email);
    // Not a 401: the web app reads that as the current session having ended.
    if (!(await verify(account.passwordHash, dto.password))) {
      throw new BadRequestException(
        'That is not the password for this account. Enter the one you already sign in with.',
      );
    }
    this.limiter.reset('passwordAccount', account.email);
    if (account.twoFactorEnabled) {
      if (!dto.code && !dto.backupCode) {
        throw new BadRequestException({
          message: 'Enter the code from your authenticator app.',
          code: 'invite_two_factor_required',
        });
      }
      await this.twoFactor.verifySignIn(account.id, {
        code: dto.code,
        backupCode: dto.backupCode,
      });
    }
    return { newPasswordHash: null };
  }

  /** Changes the signed-in user's name. The email stays fixed, because it is how they sign in. */
  async updateProfile(user: AuthUser, name: string): Promise<AuthUser> {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      throw new BadRequestException('Enter your full name.');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { name: trimmed },
    });
    await this.audit.record(user, {
      action: 'PROFILE_UPDATED',
      entityType: 'User',
      entityId: user.id,
    });
    return { ...user, name: trimmed };
  }

  /**
   * Checks the current password and sets the new one. Every other session stops
   * working, as after a reset, and this device gets a fresh session back.
   */
  async changePassword(
    user: AuthUser,
    currentPassword: string,
    newPassword: string,
  ) {
    const account = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: {
        memberships: {
          include: { organisation: { include: { settings: true } } },
        },
      },
    });
    if (
      !account?.passwordHash ||
      !(await verify(account.passwordHash, currentPassword))
    ) {
      throw new BadRequestException('Your current password is not right.');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException(
        'Choose a new password that is different from the current one.',
      );
    }
    const membership = account.memberships.find(
      (item) =>
        item.id === user.membershipId &&
        item.status === 'ACTIVE' &&
        item.organisation.status === 'ACTIVE',
    );
    if (!membership) {
      throw new UnauthorizedException(
        'No active organisation for this account',
      );
    }
    const passwordHash = await hash(newPassword);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, passwordChangedAt: now },
      }),
      // A reset link asked for before the change must not undo it.
      this.prisma.passwordReset.updateMany({
        where: { userId: user.id, usedAt: null, expiresAt: { gt: now } },
        data: { expiresAt: now },
      }),
    ]);
    await this.audit.record(user, {
      action: 'PASSWORD_CHANGED',
      entityType: 'User',
      entityId: user.id,
    });
    return this.issueSession(account, membership);
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
