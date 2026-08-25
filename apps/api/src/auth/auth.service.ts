import { BadRequestException, GoneException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { pickActiveMembership } from '../tenancy/membership';
import type { AuthUser } from './auth.types';
import { buildAuthUser } from './auth-user';
import { LoginDto } from './dto/login.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { hashInviteToken } from './invite-token';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: { memberships: { include: { organisation: { include: { settings: true } } } } },
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
      throw new UnauthorizedException('No active organisation for this account');
    }
    return this.issueSession(user, membership);
  }

  async previewInvite(token: string) {
    const invite = await this.loadInvite(token);
    return {
      email: invite.user.email,
      firstName: invite.customer.firstName,
      lastName: invite.customer.lastName,
      organisationName: invite.organisation.name,
      organisationBrandName: invite.organisation.settings?.brandName?.trim() || invite.organisation.name,
      expiresAt: invite.expiresAt,
    };
  }

  async acceptInvite(token: string, dto: AcceptInviteDto) {
    const invite = await this.loadInvite(token);
    const passwordHash = await hash(dto.password);
    const acceptedAt = new Date();
    const user = await this.prisma.$transaction(async (tx) => {
      await tx.portalInvite.update({
        where: { id: invite.id },
        data: { acceptedAt },
      });
      await tx.portalInvite.updateMany({
        where: { userId: invite.userId, acceptedAt: null, id: { not: invite.id } },
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
        include: { memberships: { include: { organisation: { include: { settings: true } } } } },
      });
    });
    const membership = user.memberships.find(
      (item) => item.organisationId === invite.organisationId && item.role === 'CUSTOMER',
    );
    if (!membership) {
      throw new UnauthorizedException('No customer membership for this invite');
    }
    void this.audit.record(buildAuthUser({ id: user.id, email: user.email, name: user.name, membership }), {
      action: 'PORTAL_ACCESS_ACCEPTED',
      entityType: 'Customer',
      entityId: invite.customerId,
      metadata: { customerId: invite.customerId },
    });
    return this.issueSession(user, membership);
  }

  private async issueSession(
    user: { id: string; email: string; name: string },
    membership: {
      id: string;
      organisationId: string;
      role: AuthUser['role'];
      customerId: string | null;
      organisation: { name: string; currency?: string; country?: string; settings?: { brandName: string | null } | null };
    },
  ) {
    const authUser = buildAuthUser({
      id: user.id,
      email: user.email,
      name: user.name,
      membership,
    });
    const accessToken = await this.jwt.signAsync({ sub: user.id, membershipId: membership.id });
    return { accessToken, user: authUser };
  }

  private async loadInvite(token: string) {
    if (!token) {
      throw new NotFoundException('Invite not found');
    }
    const invite = await this.prisma.portalInvite.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      include: {
        customer: true,
        organisation: { include: { settings: true } },
        user: true,
      },
    });
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }
    if (invite.acceptedAt) {
      throw new BadRequestException('This invite has already been used. Sign in instead.');
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('This invite has expired. Ask your importer for a new link.');
    }
    if (invite.organisation.status !== 'ACTIVE') {
      throw new UnauthorizedException('This organisation is not active');
    }
    return invite;
  }
}
