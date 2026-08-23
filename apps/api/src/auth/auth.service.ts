import { BadRequestException, GoneException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './auth.types';
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
      include: { organisation: true },
    });
    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const valid = await verify(user.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueSession(user);
  }

  async previewInvite(token: string) {
    const invite = await this.loadInvite(token);
    return {
      email: invite.user.email,
      firstName: invite.customer.firstName,
      lastName: invite.customer.lastName,
      organisationName: invite.organisation.name,
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
      return tx.user.update({
        where: { id: invite.userId },
        data: {
          passwordHash,
          name: `${invite.customer.firstName} ${invite.customer.lastName}`.trim(),
        },
        include: { organisation: true },
      });
    });
    void this.audit.record(this.toAuthUser(user), {
      action: 'PORTAL_ACCESS_ACCEPTED',
      entityType: 'Customer',
      entityId: invite.customerId,
      metadata: { customerId: invite.customerId },
    });
    return this.issueSession(user);
  }

  toAuthUser(user: {
    id: string;
    organisationId: string;
    organisation: { name: string };
    email: string;
    name: string;
    role: AuthUser['role'];
    customerId: string | null;
  }): AuthUser {
    return {
      id: user.id,
      organisationId: user.organisationId,
      organisationName: user.organisation.name,
      email: user.email,
      name: user.name,
      role: user.role,
      customerId: user.customerId,
    };
  }

  private async issueSession(user: Parameters<AuthService['toAuthUser']>[0] & { id: string }) {
    const authUser = this.toAuthUser(user);
    const accessToken = await this.jwt.signAsync({ sub: user.id });
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
        organisation: true,
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
    return invite;
  }
}
