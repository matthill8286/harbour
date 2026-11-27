import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { hash } from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { lockedTransaction } from '../../prisma/locked-transaction';
import { AuditService } from '../../audit/audit.service';
import { EmailTransport } from '../../integrations/email-transport';
import {
  composeAccountExistsEmail,
  composeSignupConfirmEmail,
} from '../../integrations/account-email';
import { RateLimiter } from '../../rate-limit/rate-limiter';
import { buildAuthUser } from '../auth-user';
import { createInviteToken, hashInviteToken } from '../invite-token';
import type { SignupDto } from './signup.dto';
import { organisationSlug } from './signup';

/** Features every new workspace gets, the same set the demo workspaces have. */
export const SIGNUP_FEATURES = ['GPS_TRACKING', 'CUSTOMER_PORTAL'] as const;

export const SIGNUP_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Sign-up emails Harbour sends in a day, to all addresses together. They are the
 * only ones a stranger can cause, so they get a small share of the allowance.
 */
export const SIGNUP_DAILY_EMAILS = 50;

const EMAIL_UNAVAILABLE =
  'We could not send the email just now. Please try again later.';
const INVALID_LINK =
  'This link is not valid or has expired. Sign up again to get a new one.';
const EMAIL_TAKEN =
  'This email already has a Harbour account. Sign in, or reset your password.';

@Injectable()
export class SignupService {
  private readonly logger = new Logger(SignupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly email: EmailTransport,
    private readonly config: ConfigService,
    private readonly limiter: RateLimiter,
  ) {}

  /**
   * Sends one email to the address, and nothing else happens until its owner
   * uses it. An address with an account is told so by email, so the caller sees
   * the same answer either way.
   */
  async request(dto: SignupDto): Promise<void> {
    const email = dto.email.trim().toLowerCase();
    this.limiter.consume('signupEmail', email);
    if (
      !this.limiter.take(
        'signup-email-total',
        SIGNUP_DAILY_EMAILS,
        SIGNUP_LINK_TTL_MS,
      )
    ) {
      throw new ServiceUnavailableException(EMAIL_UNAVAILABLE);
    }

    const { token, tokenHash } = createInviteToken();
    const now = new Date();
    await this.prisma.signupRequest.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    // Saved for every address, so both cases do the same work. Earlier links
    // keep working, so a stranger cannot cancel the owner's.
    await this.prisma.signupRequest.create({
      data: {
        email,
        organisationName: dto.organisationName.trim(),
        name: dto.name.trim(),
        tokenHash,
        expiresAt: new Date(now.getTime() + SIGNUP_LINK_TTL_MS),
      },
    });
    const account = await this.prisma.user.findUnique({
      where: { email },
      select: { passwordHash: true },
    });
    const origin = this.webOrigin();
    const message = account?.passwordHash
      ? composeAccountExistsEmail({
          signInUrl: `${origin}/login`,
          resetUrl: `${origin}/forgot-password`,
        })
      : composeSignupConfirmEmail(`${origin}/signup/confirm/${token}`);
    try {
      await this.email.deliver({ to: email, ...message });
    } catch (error) {
      this.logger.error('Failed to send a sign-up email', error as Error);
      throw new ServiceUnavailableException(EMAIL_UNAVAILABLE);
    }
  }

  async check(token: string) {
    const { email, organisationName, name, expiresAt } =
      await this.findUsable(token);
    return { email, organisationName, name, expiresAt };
  }

  /**
   * The link proves the mailbox, and its owner chooses the password. Creates a
   * new importer workspace on a trial, with them as its Admin, and signs them in.
   */
  async confirm(token: string, password: string) {
    const request = await this.findUsable(token);
    const passwordHash = await hash(password);

    let created: Awaited<ReturnType<SignupService['createWorkspace']>>;
    try {
      created = await this.createWorkspace(request, passwordHash);
    } catch (error) {
      // The account was made by something else at the same moment.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(EMAIL_TAKEN);
      }
      throw error;
    }

    const { user, membership } = created;
    const authUser = buildAuthUser({
      id: user.id,
      email: user.email,
      name: user.name,
      membership,
    });
    void this.audit.record(authUser, {
      action: 'ORGANISATION_SIGNED_UP',
      entityType: 'Organisation',
      entityId: membership.organisationId,
    });
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      membershipId: membership.id,
    });
    return { accessToken, user: authUser };
  }

  private async findUsable(token: string) {
    const request = token
      ? await this.prisma.signupRequest.findUnique({
          where: { tokenHash: hashInviteToken(token) },
        })
      : null;
    if (
      !request ||
      request.usedAt ||
      request.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException(INVALID_LINK);
    }
    return request;
  }

  private createWorkspace(
    request: {
      id: string;
      email: string;
      organisationName: string;
      name: string;
    },
    passwordHash: string,
  ) {
    // One at a time for each email, so two links used at once cannot both
    // make a workspace, or block each other.
    return lockedTransaction(
      this.prisma,
      `signup:${request.email}`,
      async (tx) => {
        const now = new Date();
        const claimed = await tx.signupRequest.updateMany({
          where: { id: request.id, usedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now },
        });
        if (claimed.count !== 1) throw new BadRequestException(INVALID_LINK);
        await tx.signupRequest.updateMany({
          where: { email: request.email, usedAt: null },
          data: { expiresAt: now },
        });
        const user = await claimOrCreateAccount(tx, request, passwordHash);
        const organisation = await tx.organisation.create({
          data: {
            name: request.organisationName,
            slug: organisationSlug(request.organisationName),
            settings: { create: { brandName: request.organisationName } },
            subscription: { create: { plan: 'STARTER', status: 'TRIAL' } },
            features: {
              create: SIGNUP_FEATURES.map((flag) => ({ flag, enabled: true })),
            },
          },
        });
        const membership = await tx.organisationMembership.create({
          data: {
            organisationId: organisation.id,
            userId: user.id,
            role: 'ADMIN',
            status: 'ACTIVE',
            acceptedAt: now,
          },
          include: { organisation: { include: { settings: true } } },
        });
        return { user, membership };
      },
    );
  }

  private webOrigin() {
    return this.config
      .get<string>('WEB_ORIGIN', 'http://localhost:5173')
      .replace(/\/$/, '');
  }
}

/**
 * An invited email may already have an account with no password. Its owner has
 * now proven the mailbox, so it becomes theirs. An account with a password is
 * never touched.
 */
async function claimOrCreateAccount(
  tx: Prisma.TransactionClient,
  request: { email: string; name: string },
  passwordHash: string,
) {
  const existing = await tx.user.findUnique({
    where: { email: request.email },
  });
  if (!existing) {
    return tx.user.create({
      data: { email: request.email, name: request.name, passwordHash },
    });
  }
  const claimed = await tx.user.updateMany({
    where: { id: existing.id, passwordHash: null },
    data: { passwordHash, name: request.name },
  });
  if (claimed.count !== 1) throw new ConflictException(EMAIL_TAKEN);
  // Nobody could have accepted without a password. An active membership found
  // here was switched on by someone else, so it goes back to waiting.
  await tx.organisationMembership.updateMany({
    where: { userId: existing.id, status: 'ACTIVE' },
    data: { status: 'INVITED', acceptedAt: null },
  });
  return { ...existing, name: request.name };
}
