import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { verify } from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthUser } from '../auth.types';
import { SecretBox } from './secret-box';
import {
  generateBackupCodes,
  generateTotpSecret,
  normaliseBackupCode,
  totpUri,
  verifyTotp,
} from './totp';

export const TWO_FACTOR_ISSUER = 'Harbour';
/** How long the sign-in challenge stays valid, matching Kleidi's ten-minute window. */
export const CHALLENGE_TTL_SECONDS = 10 * 60;
export const CHALLENGE_PURPOSE = 'two-factor';
/** After this many wrong codes the account refuses codes for the lockout period. */
export const MAX_FAILED_ATTEMPTS = 10;
export const LOCKOUT_MS = 15 * 60 * 1000;

export type ChallengePayload = {
  sub: string;
  membershipId: string;
  purpose: typeof CHALLENGE_PURPOSE;
};

type TwoFactorRow = {
  id: string;
  secret: string;
  backupCodes: string;
  verified: boolean;
  failedVerificationCount: number;
  lockedUntil: Date | null;
};

@Injectable()
export class TwoFactorService {
  private readonly box: SecretBox;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    const key =
      config.get<string>('TWO_FACTOR_ENCRYPTION_KEY') ||
      config.get<string>('JWT_SECRET', 'replace-with-a-long-random-secret');
    this.box = new SecretBox(key);
  }

  async status(user: AuthUser) {
    const row = await this.prisma.twoFactor.findUnique({
      where: { userId: user.id },
    });
    const enabled = Boolean(row?.verified) && user.twoFactorEnabled;
    return {
      enabled,
      backupCodesRemaining: enabled && row ? this.readCodes(row).length : 0,
    };
  }

  /** Step one of setup: confirm the password, then hand back a fresh secret and backup codes. */
  async enable(user: AuthUser, password: string) {
    const account = await this.requirePassword(user.id, password);
    if (account.twoFactorEnabled) {
      throw new BadRequestException(
        'Two-factor sign-in is already on. Turn it off before setting it up again.',
      );
    }
    const secret = generateTotpSecret();
    const backupCodes = generateBackupCodes();
    const data = {
      secret: this.box.encrypt(secret),
      backupCodes: this.box.encrypt(JSON.stringify(backupCodes)),
      verified: false,
      failedVerificationCount: 0,
      lockedUntil: null,
    };
    await this.prisma.twoFactor.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });
    return {
      totpURI: totpUri({
        issuer: TWO_FACTOR_ISSUER,
        account: account.email,
        secret,
      }),
      secret,
      backupCodes,
    };
  }

  /** Step two of setup: a working code from the authenticator switches two-factor on. */
  async verifyEnrolment(user: AuthUser, code: string) {
    const row = await this.prisma.twoFactor.findUnique({
      where: { userId: user.id },
    });
    if (!row) {
      throw new BadRequestException('Start two-factor setup first.');
    }
    await this.checkCode(row, { code });
    await this.prisma.$transaction([
      this.prisma.twoFactor.update({
        where: { id: row.id },
        data: { verified: true, failedVerificationCount: 0, lockedUntil: null },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { twoFactorEnabled: true },
      }),
    ]);
    void this.audit.record(user, {
      action: 'TWO_FACTOR_ENABLED',
      entityType: 'User',
      entityId: user.id,
    });
    return { enabled: true };
  }

  async disable(user: AuthUser, password: string) {
    await this.requirePassword(user.id, password);
    await this.prisma.$transaction([
      this.prisma.twoFactor.deleteMany({ where: { userId: user.id } }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { twoFactorEnabled: false },
      }),
    ]);
    void this.audit.record(user, {
      action: 'TWO_FACTOR_DISABLED',
      entityType: 'User',
      entityId: user.id,
    });
    return { enabled: false };
  }

  async regenerateBackupCodes(user: AuthUser, password: string) {
    const account = await this.requirePassword(user.id, password);
    const row = await this.prisma.twoFactor.findUnique({
      where: { userId: user.id },
    });
    if (!account.twoFactorEnabled || !row?.verified) {
      throw new BadRequestException('Turn on two-factor sign-in first.');
    }
    const backupCodes = generateBackupCodes();
    await this.prisma.twoFactor.update({
      where: { id: row.id },
      data: { backupCodes: this.box.encrypt(JSON.stringify(backupCodes)) },
    });
    void this.audit.record(user, {
      action: 'TWO_FACTOR_BACKUP_CODES_REGENERATED',
      entityType: 'User',
      entityId: user.id,
    });
    return { backupCodes };
  }

  /** Issued instead of an access token when the password is right but a code is still due. */
  async createChallenge(userId: string, membershipId: string) {
    const payload: ChallengePayload = {
      sub: userId,
      membershipId,
      purpose: CHALLENGE_PURPOSE,
    };
    const challengeToken = await this.jwt.signAsync(payload, {
      expiresIn: CHALLENGE_TTL_SECONDS,
    });
    return {
      twoFactorRequired: true as const,
      challengeToken,
      expiresIn: CHALLENGE_TTL_SECONDS,
    };
  }

  async readChallenge(token: string): Promise<ChallengePayload> {
    try {
      const payload =
        await this.jwt.verifyAsync<Partial<ChallengePayload>>(token);
      if (
        payload.purpose !== CHALLENGE_PURPOSE ||
        !payload.sub ||
        !payload.membershipId
      ) {
        throw new Error('wrong purpose');
      }
      return payload as ChallengePayload;
    } catch {
      throw new UnauthorizedException(
        'This sign-in has expired. Enter your email and password again.',
      );
    }
  }

  /** Checks the second step of sign-in. A backup code works once and is then removed. */
  async verifySignIn(
    userId: string,
    input: { code?: string; backupCode?: string },
  ) {
    const row = await this.prisma.twoFactor.findUnique({ where: { userId } });
    if (!row?.verified) {
      throw new UnauthorizedException('Two-factor sign-in is not set up.');
    }
    await this.checkCode(row, input);
    await this.prisma.twoFactor.update({
      where: { id: row.id },
      data: { failedVerificationCount: 0, lockedUntil: null },
    });
  }

  private async checkCode(
    row: TwoFactorRow,
    input: { code?: string; backupCode?: string },
  ) {
    if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
      throw new HttpException(
        'Too many wrong codes. Try again in a few minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    let ok = false;
    if (input.code) {
      ok = verifyTotp(this.box.decrypt(row.secret), input.code);
    } else if (input.backupCode && row.verified) {
      ok = await this.consumeBackupCode(row, input.backupCode);
    }
    if (ok) return;

    const failed = row.failedVerificationCount + 1;
    const locked = failed >= MAX_FAILED_ATTEMPTS;
    await this.prisma.twoFactor.update({
      where: { id: row.id },
      data: {
        failedVerificationCount: locked ? 0 : failed,
        lockedUntil: locked ? new Date(Date.now() + LOCKOUT_MS) : null,
      },
    });
    throw new UnauthorizedException('That code is not right.');
  }

  private async consumeBackupCode(row: TwoFactorRow, code: string) {
    const wanted = normaliseBackupCode(code);
    const codes = this.readCodes(row);
    const index = codes.indexOf(wanted);
    if (index === -1) return false;
    codes.splice(index, 1);
    // Only remove the code if nobody else used it first, so one code cannot sign in twice.
    const result = await this.prisma.twoFactor.updateMany({
      where: { id: row.id, backupCodes: row.backupCodes },
      data: { backupCodes: this.box.encrypt(JSON.stringify(codes)) },
    });
    return result.count === 1;
  }

  private readCodes(row: Pick<TwoFactorRow, 'backupCodes'>): string[] {
    const parsed: unknown = JSON.parse(this.box.decrypt(row.backupCodes));
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private async requirePassword(userId: string, password: string) {
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (
      !account?.passwordHash ||
      !(await verify(account.passwordHash, password))
    ) {
      throw new UnauthorizedException('That password is not right.');
    }
    return account;
  }
}
