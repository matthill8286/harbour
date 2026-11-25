import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash } from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailTransport } from '../../integrations/email-transport';
import { createInviteToken, hashInviteToken } from '../invite-token';

/** A reset link works for one hour and only once. */
export const RESET_TTL_MS = 60 * 60 * 1000;
/** One email per minute per account, so the form cannot be used to flood an inbox. */
export const RESET_RESEND_MS = 60 * 1000;

const INVALID_LINK =
  'This reset link is not valid or has expired. Ask for a new one.';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailTransport,
    private readonly config: ConfigService,
  ) {}

  /**
   * Emails a reset link if the account exists. The answer is the same either way,
   * so the form does not reveal which addresses have accounts.
   */
  async request(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Accounts that never set a password are still waiting on an invite.
    if (!user?.passwordHash) return;

    const recent = await this.prisma.passwordReset.findFirst({
      where: {
        userId: user.id,
        createdAt: { gt: new Date(Date.now() - RESET_RESEND_MS) },
      },
    });
    if (recent) return;

    const { token, tokenHash } = createInviteToken();
    const now = new Date();
    await this.prisma.$transaction([
      // Only the newest link works.
      this.prisma.passwordReset.updateMany({
        where: { userId: user.id, usedAt: null, expiresAt: { gt: now } },
        data: { expiresAt: now },
      }),
      this.prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(now.getTime() + RESET_TTL_MS),
        },
      }),
    ]);

    const url = `${this.webOrigin()}/reset-password/${token}`;
    const name = user.name.trim().split(/\s+/)[0] || 'there';
    try {
      await this.email.send({
        to: user.email,
        subject: 'Reset your Harbour password',
        text: [
          `Hi ${name},`,
          '',
          'Someone asked to reset the password for your Harbour account.',
          `Choose a new password here within the next hour: ${url}`,
          '',
          'If this was not you, ignore this email. Your password stays the same.',
        ].join('\n'),
        html: [
          `<p>Hi ${escapeHtml(name)},</p>`,
          '<p>Someone asked to reset the password for your Harbour account.</p>',
          `<p><a href="${url}">Choose a new password</a>. The link works for one hour.</p>`,
          '<p>If this was not you, ignore this email. Your password stays the same.</p>',
        ].join(''),
      });
    } catch (error) {
      // The caller always gets the same answer; the failure is for the logs.
      this.logger.error('Failed to send password reset email', error as Error);
    }
  }

  async check(token: string) {
    const reset = await this.findUsable(token);
    return { email: reset.user.email, expiresAt: reset.expiresAt };
  }

  /** Sets the new password, uses up the link and signs out every existing session. */
  async reset(token: string, password: string): Promise<void> {
    const reset = await this.findUsable(token);
    const passwordHash = await hash(password);
    const now = new Date();
    const claimed = await this.prisma.passwordReset.updateMany({
      where: { id: reset.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw new BadRequestException(INVALID_LINK);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: reset.userId },
        data: { passwordHash, passwordChangedAt: now },
      }),
      this.prisma.passwordReset.updateMany({
        where: { userId: reset.userId, usedAt: null },
        data: { expiresAt: now },
      }),
    ]);
  }

  private async findUsable(token: string) {
    if (!token) throw new BadRequestException(INVALID_LINK);
    const reset = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      include: { user: true },
    });
    if (!reset || reset.usedAt || reset.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(INVALID_LINK);
    }
    return reset;
  }

  private webOrigin() {
    return this.config
      .get<string>('WEB_ORIGIN', 'http://localhost:5173')
      .replace(/\/$/, '');
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
