import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { accessLock, lockedTransaction } from '../prisma/locked-transaction';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../integrations/notifications.service';
import { EmailTransport } from '../integrations/email-transport';
import type { AuthUser } from '../auth/auth.types';
import { createInviteToken, inviteExpiresAt } from '../auth/invite-token';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { describePortalAccess } from './portal-access';
import { portalMembershipWasAccepted } from '../auth/accepted-membership';

const portalUserSelect = { id: true, email: true, passwordHash: true } as const;
const pendingInviteSelect = { createdAt: true, expiresAt: true } as const;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailTransport,
  ) {}

  async list(user: AuthUser, search?: string) {
    const customers = await this.prisma.customer.findMany({
      where: {
        organisationId: user.organisationId,
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        _count: { select: { importJobs: true } },
        memberships: {
          where: { role: 'CUSTOMER' },
          select: { status: true, user: { select: portalUserSelect } },
          take: 1,
        },
        portalInvites: {
          where: { acceptedAt: null, expiresAt: { gt: new Date() } },
          select: pendingInviteSelect,
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return customers.map((customer) => this.present(customer));
  }

  async get(user: AuthUser, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, organisationId: user.organisationId },
      include: {
        importJobs: {
          include: {
            vehicle: {
              select: { make: true, model: true, ukRegistration: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        memberships: {
          where: { role: 'CUSTOMER' },
          select: { status: true, user: { select: portalUserSelect } },
          take: 1,
        },
        portalInvites: {
          where: { acceptedAt: null, expiresAt: { gt: new Date() } },
          select: pendingInviteSelect,
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return this.present(customer);
  }

  create(user: AuthUser, dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: {
        organisationId: user.organisationId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email?.toLowerCase(),
        phone: dto.phone,
        address: dto.address,
        notes: dto.notes,
      },
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateCustomerDto) {
    await lockedTransaction(
      this.prisma,
      accessLock(user.organisationId),
      async (tx) => {
        const customer = await this.requireCustomer(user, id, tx);
        const email = dto.email?.toLowerCase();
        if (email && email !== customer.email?.toLowerCase()) {
          await this.moveUnclaimedPortalAccount(
            tx,
            user.organisationId,
            id,
            email,
          );
        }
        await tx.customer.update({
          where: { id },
          data: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            email,
            phone: dto.phone,
            address: dto.address,
            notes: dto.notes,
          },
        });
      },
    );
    return this.get(user, id);
  }

  async invite(user: AuthUser, id: string) {
    const { token, tokenHash } = createInviteToken();
    const expiresAt = inviteExpiresAt();
    // The old access is removed and the new invite made together, or not at all.
    const { customer, email } = await lockedTransaction(
      this.prisma,
      accessLock(user.organisationId),
      async (tx) => {
        const customer = await this.requireCustomer(user, id, tx);
        const email = customer.email?.toLowerCase();
        if (!email) {
          throw new BadRequestException(
            'Add an email address before inviting this customer',
          );
        }

        const existing = await tx.user.findUnique({
          where: { email },
          include: { memberships: true },
        });
        const existingHere = existing?.memberships.find(
          (item) => item.organisationId === user.organisationId,
        );
        if (
          existingHere &&
          (existingHere.role !== 'CUSTOMER' ||
            existingHere.customerId !== customer.id)
        ) {
          throw new ConflictException(
            'That email already belongs to another account',
          );
        }

        const portalUser =
          existing ??
          (await tx.user.create({
            data: {
              email,
              name: `${customer.firstName} ${customer.lastName}`.trim(),
            },
          }));

        await this.removeOtherPortalAccounts(
          tx,
          user.organisationId,
          customer.id,
          portalUser.id,
        );

        // Someone who already accepted stays active. Anyone else has to accept, even
        // when the email already has a Harbour account.
        const accepted = existingHere
          ? await portalMembershipWasAccepted(tx, {
              organisationId: user.organisationId,
              userId: portalUser.id,
              customerId: customer.id,
              acceptedAt: existingHere.acceptedAt,
            })
          : false;
        const status = accepted ? 'ACTIVE' : 'INVITED';

        await tx.organisationMembership.upsert({
          where: {
            organisationId_userId: {
              organisationId: user.organisationId,
              userId: portalUser.id,
            },
          },
          update: {
            role: 'CUSTOMER',
            customerId: customer.id,
            status,
          },
          create: {
            organisationId: user.organisationId,
            userId: portalUser.id,
            role: 'CUSTOMER',
            status: 'INVITED',
            customerId: customer.id,
          },
        });

        await tx.portalInvite.updateMany({
          where: { customerId: customer.id, acceptedAt: null },
          data: { expiresAt: new Date() },
        });

        await tx.portalInvite.create({
          data: {
            organisationId: user.organisationId,
            customerId: customer.id,
            userId: portalUser.id,
            createdById: user.id,
            tokenHash,
            expiresAt,
          },
        });

        return { customer, email };
      },
    );

    const inviteUrl = `${this.webOrigin()}/invite/${token}`;
    void this.audit.record(user, {
      action: 'CUSTOMER_INVITED',
      entityType: 'Customer',
      entityId: customer.id,
      metadata: {
        customerId: customer.id,
        email,
        expiresAt: expiresAt.toISOString(),
      },
    });
    // As for staff, only the invitee's mailbox gets the link.
    const emailSent = await this.notifications.sendPortalInvite({
      type: 'PORTAL_INVITE',
      organisationId: user.organisationId,
      customerId: customer.id,
      inviteUrl,
      message: `Portal invite for ${email}`,
    });

    const presented = await this.get(user, id);
    return {
      ...presented,
      expiresAt,
      emailSent,
      ...(this.email.localDelivery() ? { inviteUrl } : {}),
    };
  }

  /**
   * A portal account is the person's own, shared by every organisation that
   * knows that email. An organisation may change its sign-in email only while
   * nobody has claimed it: no password, and no link to another organisation.
   * Otherwise only the contact email on the customer record changes.
   */
  private async moveUnclaimedPortalAccount(
    tx: Prisma.TransactionClient,
    organisationId: string,
    customerId: string,
    email: string,
  ) {
    const membership = await tx.organisationMembership.findFirst({
      where: { customerId, organisationId, role: 'CUSTOMER' },
      select: { userId: true },
    });
    if (!membership) return;
    const unclaimed = {
      id: membership.userId,
      passwordHash: null,
      memberships: { every: { organisationId } },
    };
    const account = await tx.user.findFirst({
      where: unclaimed,
      select: { email: true },
    });
    if (!account || account.email === email) return;
    const taken = await tx.user.findUnique({ where: { email } });
    if (taken) {
      throw new ConflictException(
        'That email already belongs to another account',
      );
    }
    const moved = await tx.user.updateMany({
      where: unclaimed,
      data: { email },
    });
    if (moved.count === 0) return;
    // Links made for the old address must not open the new one.
    await tx.portalInvite.updateMany({
      where: { organisationId, userId: membership.userId, acceptedAt: null },
      data: { expiresAt: new Date() },
    });
  }

  /** Inviting a new email moves the customer's portal access to that account. */
  private async removeOtherPortalAccounts(
    tx: Prisma.TransactionClient,
    organisationId: string,
    customerId: string,
    keepUserId: string,
  ) {
    await tx.organisationMembership.deleteMany({
      where: {
        organisationId,
        customerId,
        role: 'CUSTOMER',
        userId: { not: keepUserId },
      },
    });
  }

  private webOrigin() {
    return this.config
      .get<string>('WEB_ORIGIN', 'http://localhost:5173')
      .replace(/\/$/, '');
  }

  private async requireCustomer(
    user: AuthUser,
    id: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const customer = await db.customer.findFirst({
      where: { id, organisationId: user.organisationId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  private present<
    T extends {
      memberships: Array<{
        status: string;
        user: { id: string; email: string; passwordHash: string | null };
      }>;
      portalInvites: Array<{ createdAt: Date; expiresAt: Date }>;
    },
  >(customer: T) {
    const { memberships, portalInvites, ...rest } = customer;
    const portalAccount = memberships[0]?.user ?? null;
    return {
      ...rest,
      portal: describePortalAccess({
        user: portalAccount
          ? {
              id: portalAccount.id,
              email: portalAccount.email,
              hasPassword:
                memberships[0].status !== 'INVITED' &&
                Boolean(portalAccount.passwordHash),
            }
          : null,
        pendingInvite: portalInvites[0] ?? null,
      }),
    };
  }
}
