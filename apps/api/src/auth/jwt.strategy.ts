import {
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { accessFor } from '../licensing/licence';
import { LicensingService } from '../licensing/licensing.service';
import { planIsReadOnly } from '../tenancy/plan-policy';
import { buildAuthUser } from './auth-user';
import { jwtSecret } from './secrets';
import type { AuthUser } from './auth.types';

export type JwtPayload = {
  sub: string;
  /** The one membership, and so the one workspace, this session belongs to. */
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
    @Optional() private readonly licensing?: LicensingService,
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
          include: {
            organisation: { include: { settings: true, subscription: true } },
          },
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
    // A session that names no workspace is refused rather than given one.
    const membership = user.memberships.find(
      (item) => item.id === payload.membershipId,
    );
    if (
      !membership ||
      membership.status !== 'ACTIVE' ||
      membership.organisation.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException();
    }
    const authUser = buildAuthUser({
      id: user.id,
      email: user.email,
      name: user.name,
      twoFactorEnabled: user.twoFactorEnabled,
      membership,
    });
    // Where licences are checked, every request of every member and customer of
    // the workspace passes here. A workspace whose licence does not let it be
    // used is refused, and one that can only be read is read-only.
    const access = this.licensing?.enabled
      ? accessFor(await this.licensing.forWorkspace(membership.organisationId))
      : 'full';
    if (access === 'none') {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'licence_inactive',
        message:
          'This workspace has no active Harbour licence. Contact us to renew it.',
      });
    }
    return access === 'read' ||
      planIsReadOnly(membership.organisation.subscription)
      ? { ...authUser, workspaceReadOnly: true }
      : authUser;
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
