import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../integrations/notifications.service';
import type { AuthUser } from '../auth/auth.types';
import { createInviteToken, inviteExpiresAt } from '../auth/invite-token';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { describePortalAccess } from './portal-access';

const portalUserSelect = { id: true, email: true, passwordHash: true } as const;
const pendingInviteSelect = { createdAt: true, expiresAt: true } as const;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
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
          select: { user: { select: portalUserSelect } },
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
          include: { vehicle: { select: { make: true, model: true, ukRegistration: true } } },
          orderBy: { createdAt: 'desc' },
        },
        memberships: {
          where: { role: 'CUSTOMER' },
          select: { user: { select: portalUserSelect } },
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
    await this.requireCustomer(user, id);
    const email = dto.email?.toLowerCase();
    if (email) {
      const membership = await this.prisma.organisationMembership.findFirst({
        where: { customerId: id, organisationId: user.organisationId, role: 'CUSTOMER' },
        include: { user: true },
      });
      if (membership && membership.user.email !== email) {
        const taken = await this.prisma.user.findUnique({ where: { email } });
        if (taken && taken.id !== membership.userId) {
          throw new ConflictException('That email already belongs to another account');
        }
        await this.prisma.user.update({
          where: { id: membership.userId },
          data: { email },
        });
      }
    }
    await this.prisma.customer.update({
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
    return this.get(user, id);
  }

  async invite(user: AuthUser, id: string) {
    const customer = await this.requireCustomer(user, id);
    const email = customer.email?.toLowerCase();
    if (!email) {
      throw new BadRequestException('Add an email address before inviting this customer');
    }

    const existing = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: true },
    });
    const existingHere = existing?.memberships.find((item) => item.organisationId === user.organisationId);
    if (
      existingHere &&
      (existingHere.role !== 'CUSTOMER' || existingHere.customerId !== customer.id)
    ) {
      throw new ConflictException('That email already belongs to another account');
    }

    const portalUser =
      existing ??
      (await this.prisma.user.create({
        data: {
          email,
          name: `${customer.firstName} ${customer.lastName}`.trim(),
        },
      }));

    await this.prisma.organisationMembership.upsert({
      where: {
        organisationId_userId: { organisationId: user.organisationId, userId: portalUser.id },
      },
      update: {
        role: 'CUSTOMER',
        customerId: customer.id,
        status: portalUser.passwordHash ? 'ACTIVE' : 'INVITED',
      },
      create: {
        organisationId: user.organisationId,
        userId: portalUser.id,
        role: 'CUSTOMER',
        status: 'INVITED',
        customerId: customer.id,
      },
    });

    await this.prisma.portalInvite.updateMany({
      where: { customerId: customer.id, acceptedAt: null },
      data: { expiresAt: new Date() },
    });

    const { token, tokenHash } = createInviteToken();
    const expiresAt = inviteExpiresAt();
    await this.prisma.portalInvite.create({
      data: {
        organisationId: user.organisationId,
        customerId: customer.id,
        userId: portalUser.id,
        createdById: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const inviteUrl = `${this.webOrigin()}/invite/${token}`;
    void this.audit.record(user, {
      action: 'CUSTOMER_INVITED',
      entityType: 'Customer',
      entityId: customer.id,
      metadata: { customerId: customer.id, email, expiresAt: expiresAt.toISOString() },
    });
    this.notifications.notify({
      type: 'PORTAL_INVITE',
      customerId: customer.id,
      message: `Portal invite for ${email}: ${inviteUrl}`,
    });

    const presented = await this.get(user, id);
    return { ...presented, inviteUrl, expiresAt };
  }

  private webOrigin() {
    return this.config.get<string>('WEB_ORIGIN', 'http://localhost:5173').replace(/\/$/, '');
  }

  private async requireCustomer(user: AuthUser, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, organisationId: user.organisationId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  private present<
    T extends {
      memberships: Array<{ user: { id: string; email: string; passwordHash: string | null } }>;
      portalInvites: Array<{ createdAt: Date; expiresAt: Date }>;
    },
  >(customer: T) {
    const { memberships, portalInvites, ...rest } = customer;
    const portalAccount = memberships[0]?.user ?? null;
    return {
      ...rest,
      portal: describePortalAccess({
        user: portalAccount
          ? { id: portalAccount.id, email: portalAccount.email, hasPassword: Boolean(portalAccount.passwordHash) }
          : null,
        pendingInvite: portalInvites[0] ?? null,
      }),
    };
  }
}
