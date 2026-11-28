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
  matchTotpStep,
} from './totp';
import { twoFactorKeys } from '../secrets';

export const TWO_FACTOR_ISSUER = 'Harbour';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$|\.(localhost|test)$/;

/**
 * The name an authenticator app shows for this site, so a local or staging
 * entry never looks like the live one: "Harbour" for the live site,
 * "Harbour (localhost)" locally, "Harbour (staging)" on staging, and the host
 * in brackets anywhere else that is not a harbour.* address.
 */
export function authenticatorIssuer(webOrigin: string | undefined): string {
  const first = (webOrigin ?? '').split(',')[0]?.trim();
  let host: string;
  try {
    host = new URL(first || 'http://localhost').hostname;
  } catch {
    return TWO_FACTOR_ISSUER;
  }
  if (LOCAL_HOST.test(host)) return `${TWO_FACTOR_ISSUER} (localhost)`;
  if (/(^|[.-])staging([.-]|$)/.test(host))
    return `${TWO_FACTOR_ISSUER} (staging)`;
  if (/^harbour\./.test(host)) return TWO_FACTOR_ISSUER;
  return `${TWO_FACTOR_ISSUER} (${host})`;
}
/** How long the sign-in challenge stays valid, matching Kleidi's ten-minute window. */
export const CHALLENGE_TTL_SECONDS = 10 * 60;
export const CHALLENGE_PURPOSE = 'two-factor';
/**
 * After this many wrong codes the account refuses codes for the lockout period.
 * Wrong passwords on the two-factor settings are limited the same way.
 */
export const MAX_FAILED_ATTEMPTS = 10;
export const LOCKOUT_MS = 15 * 60 * 1000;

/** Matches a counter that still has an attempt left and is not locked. */
function notLocked(countField: string, lockField: string, now: Date) {
  return {
    [countField]: { lt: MAX_FAILED_ATTEMPTS },
    OR: [{ [lockField]: null }, { [lockField]: { lte: now } }],
  };
}

function tooManyAttempts(what: 'codes' | 'passwords') {
  return new HttpException(
    `Too many wrong ${what}. Try again in a few minutes.`,
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

export type ChallengePayload = {
  sub: string;
  membershipId: string;
  purpose: typeof CHALLENGE_PURPOSE;
  iat?: number;
};

type SecondFactor = { code?: string; backupCode?: string };

type TwoFactorRow = {
  id: string;
  secret: string;
  backupCodes: string;
  verified: boolean;
};

@Injectable()
export class TwoFactorService {
  private readonly box: SecretBox;
  /** What the authenticator app calls this site. */
  private readonly issuer: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    const keys = twoFactorKeys(config);
    this.box = new SecretBox(keys.current, keys.previous);
    this.issuer = authenticatorIssuer(config.get<string>('WEB_ORIGIN'));
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
      lastUsedStep: null,
    };
    await this.prisma.twoFactor.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });
    return {
      totpURI: totpUri({
        issuer: this.issuer,
        account: account.email,
        secret,
      }),
      secret,
      backupCodes,
    };
  }

  /**
   * Step two of setup: a working code from the authenticator switches two-factor
   * on. Every session started before then ends, and this device gets a new one.
   */
  async verifyEnrolment(user: AuthUser, code: string) {
    const row = await this.prisma.twoFactor.findUnique({
      where: { userId: user.id },
    });
    if (!row) {
      throw new BadRequestException('Start two-factor setup first.');
    }
    if (row.verified && user.twoFactorEnabled) {
      throw new BadRequestException('Two-factor sign-in is already on.');
    }
    await this.checkCode(row, { code });
    await this.prisma.$transaction([
      this.prisma.twoFactor.update({
        where: { id: row.id },
        data: { verified: true },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { twoFactorEnabled: true, sessionsRevokedAt: new Date() },
      }),
    ]);
    void this.audit.record(user, {
      action: 'TWO_FACTOR_ENABLED',
      entityType: 'User',
      entityId: user.id,
    });
    // Signed after the cut-off above, so it is the one session that survives.
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      membershipId: user.membershipId,
    });
    return {
      enabled: true,
      accessToken,
      user: { ...user, twoFactorEnabled: true },
    };
  }

  /** Needs the password and, while two-factor is on, a code that proves the second factor. */
  async disable(user: AuthUser, password: string, input: SecondFactor) {
    const account = await this.requirePassword(user.id, password);
    const row = await this.prisma.twoFactor.findUnique({
      where: { userId: user.id },
    });
    if (account.twoFactorEnabled && row?.verified) {
      await this.requireCode(row, input);
    }
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

  /** Needs a code too: a new backup code would otherwise be enough to turn two-factor off. */
  async regenerateBackupCodes(
    user: AuthUser,
    password: string,
    input: SecondFactor,
  ) {
    const account = await this.requirePassword(user.id, password);
    const row = await this.prisma.twoFactor.findUnique({
      where: { userId: user.id },
    });
    if (!account.twoFactorEnabled || !row?.verified) {
      throw new BadRequestException('Turn on two-factor sign-in first.');
    }
    await this.requireCode(row, input);
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

  /**
   * Both factors again, before something that cannot be undone. It needs
   * two-factor to be on. A wrong answer is not a 401, which the web app would
   * read as the session having ended.
   */
  async confirmIdentity(userId: string, password: string, input: SecondFactor) {
    try {
      const account = await this.requirePassword(userId, password);
      const row = await this.prisma.twoFactor.findUnique({
        where: { userId },
      });
      if (!account.twoFactorEnabled || !row?.verified) {
        throw new BadRequestException('Turn on two-factor sign-in first.');
      }
      await this.requireCode(row, input);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
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
  async verifySignIn(userId: string, input: SecondFactor) {
    const row = await this.prisma.twoFactor.findUnique({ where: { userId } });
    if (!row?.verified) {
      throw new UnauthorizedException('Two-factor sign-in is not set up.');
    }
    await this.checkCode(row, input);
  }

  private async requireCode(row: TwoFactorRow, input: SecondFactor) {
    if (!input.code && !input.backupCode) {
      throw new BadRequestException(
        'Enter a code from your authenticator app, or a backup code.',
      );
    }
    await this.checkCode(row, input);
  }

  /**
   * Takes an attempt from the counter before looking at the code. The database
   * does both in one step, so guesses sent together cannot share an attempt.
   */
  private async checkCode(row: TwoFactorRow, input: SecondFactor) {
    const claimed = await this.prisma.twoFactor.updateMany({
      where: {
        id: row.id,
        ...notLocked('failedVerificationCount', 'lockedUntil', new Date()),
      },
      data: { failedVerificationCount: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      await this.lockCodesIfSpent(row.id);
      throw tooManyAttempts('codes');
    }
    let ok = false;
    if (input.code) {
      ok = await this.consumeTotp(row, input.code);
    } else if (input.backupCode && row.verified) {
      ok = await this.consumeBackupCode(row, input.backupCode);
    }
    if (!ok) {
      await this.lockCodesIfSpent(row.id);
      throw new UnauthorizedException('That code is not right.');
    }
    await this.prisma.twoFactor.update({
      where: { id: row.id },
      data: { failedVerificationCount: 0, lockedUntil: null },
    });
  }

  private async lockCodesIfSpent(id: string) {
    await this.prisma.twoFactor.updateMany({
      where: { id, failedVerificationCount: { gte: MAX_FAILED_ATTEMPTS } },
      data: {
        failedVerificationCount: 0,
        lockedUntil: new Date(Date.now() + LOCKOUT_MS),
      },
    });
  }

  /** A code works once. Neither it nor an earlier one is accepted again. */
  private async consumeTotp(row: TwoFactorRow, code: string) {
    const step = matchTotpStep(this.box.decrypt(row.secret), code);
    if (step === null) return false;
    const result = await this.prisma.twoFactor.updateMany({
      where: {
        id: row.id,
        OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }],
      },
      data: { lastUsedStep: step },
    });
    if (result.count !== 1) {
      throw new UnauthorizedException(
        'That code has already been used. Wait for your app to show a new one.',
      );
    }
    return true;
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

  /** Checks the password, with the same limit on wrong tries as codes have. */
  private async requirePassword(userId: string, password: string) {
    const claimed = await this.prisma.user.updateMany({
      where: {
        id: userId,
        ...notLocked(
          'passwordCheckFailedCount',
          'passwordCheckLockedUntil',
          new Date(),
        ),
      },
      data: { passwordCheckFailedCount: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      await this.lockPasswordIfSpent(userId);
      throw tooManyAttempts('passwords');
    }
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (
      !account?.passwordHash ||
      !(await verify(account.passwordHash, password))
    ) {
      await this.lockPasswordIfSpent(userId);
      throw new UnauthorizedException('That password is not right.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordCheckFailedCount: 0, passwordCheckLockedUntil: null },
    });
    return account;
  }

  private async lockPasswordIfSpent(userId: string) {
    await this.prisma.user.updateMany({
      where: {
        id: userId,
        passwordCheckFailedCount: { gte: MAX_FAILED_ATTEMPTS },
      },
      data: {
        passwordCheckFailedCount: 0,
        passwordCheckLockedUntil: new Date(Date.now() + LOCKOUT_MS),
      },
    });
  }
}
