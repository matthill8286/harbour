import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { pickActiveMembership } from '../tenancy/membership';
import { buildAuthUser } from './auth-user';
import { jwtSecret } from './secrets';
import type { AuthUser } from './auth.types';

export type JwtPayload = {
  sub: string;
  membershipId?: string;
  /** Set on short-lived tokens that are not sessions, such as the two-factor challenge. */
  purpose?: string;
  /** Issued-at, in seconds, added by the JWT library. */
  iat?: number;
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
      secretOrKey: jwtSecret(config),
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
    if (
      !user ||
      issuedBeforePasswordChange(payload.iat, user.passwordChangedAt) ||
      // The same comparison, for sessions ended when two-factor was turned on.
      issuedBeforePasswordChange(payload.iat, user.sessionsRevokedAt)
    ) {
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

/** A password reset ends every session that was started with the old password. */
export function issuedBeforePasswordChange(
  issuedAtSeconds: number | undefined,
  passwordChangedAt: Date | null | undefined,
): boolean {
  if (!passwordChangedAt) return false;
  return (
    (issuedAtSeconds ?? 0) < Math.floor(passwordChangedAt.getTime() / 1000)
  );
}
