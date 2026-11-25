import { ConflictException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { hash } from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { buildAuthUser } from '../auth-user';
import type { SignupDto } from './signup.dto';
import { organisationSlug } from './signup';

/** Features every new workspace gets, the same set the demo workspaces have. */
export const SIGNUP_FEATURES = ['GPS_TRACKING', 'CUSTOMER_PORTAL'] as const;

const EMAIL_TAKEN =
  'An account with this email already exists. Sign in, or reset your password.';

@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  /** Creates a new importer workspace on a trial, with the person signing up as its owner. */
  async signup(dto: SignupDto) {
    const email = dto.email.trim().toLowerCase();
    const organisationName = dto.organisationName.trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException(EMAIL_TAKEN);
    const passwordHash = await hash(dto.password);

    let created: Awaited<ReturnType<SignupService['createWorkspace']>>;
    try {
      created = await this.createWorkspace({
        organisationName,
        name: dto.name.trim(),
        email,
        passwordHash,
      });
    } catch (error) {
      // Two sign-ups with the same email at once: the database keeps one.
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

  private createWorkspace(input: {
    organisationName: string;
    name: string;
    email: string;
    passwordHash: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const organisation = await tx.organisation.create({
        data: {
          name: input.organisationName,
          slug: organisationSlug(input.organisationName),
          settings: { create: { brandName: input.organisationName } },
          subscription: { create: { plan: 'STARTER', status: 'TRIAL' } },
          features: {
            create: SIGNUP_FEATURES.map((flag) => ({ flag, enabled: true })),
          },
        },
      });
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash: input.passwordHash,
        },
      });
      const membership = await tx.organisationMembership.create({
        data: {
          organisationId: organisation.id,
          userId: user.id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
        include: { organisation: { include: { settings: true } } },
      });
      return { user, membership };
    });
  }
}
