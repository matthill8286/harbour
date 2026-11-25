import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { pickActiveMembership } from '../tenancy/membership';
import { buildAuthUser } from './auth-user';
import type { AuthUser } from './auth.types';

export type JwtPayload = {
  sub: string;
  membershipId?: string;
  /** Set on short-lived tokens that are not sessions, such as the two-factor challenge. */
  purpose?: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>(
        'JWT_SECRET',
        'replace-with-a-long-random-secret',
      ),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (payload.purpose) {
      throw new UnauthorizedException();
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        memberships: {
          include: { organisation: { include: { settings: true } } },
        },
      },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    const membership = payload.membershipId
      ? user.memberships.find((item) => item.id === payload.membershipId)
      : pickActiveMembership(user.memberships);
    if (
      !membership ||
      membership.status !== 'ACTIVE' ||
      membership.organisation.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException();
    }
    return buildAuthUser({
      id: user.id,
      email: user.email,
      name: user.name,
      twoFactorEnabled: user.twoFactorEnabled,
      membership,
    });
  }
}
