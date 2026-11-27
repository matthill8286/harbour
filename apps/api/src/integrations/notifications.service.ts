import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  composeCustomerEmail,
  type CustomerEmailEventType,
} from './customer-email';
import { EmailTransport } from './email-transport';
import { EmailRetryQueue } from './email-retry-queue';
import {
  composeStaffInviteEmail,
  type StaffInviteEmail,
} from './account-email';
import { RateLimiter } from '../rate-limit/rate-limiter';

/** Customer notifications one workspace may send in a day. */
export const WORKSPACE_DAILY_NOTIFICATIONS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CustomerNotification = {
  type: CustomerEmailEventType;
  organisationId: string;
  customerId: string | null;
  importJobId?: string;
  message: string;
  inviteUrl?: string;
};

@Injectable()
export class NotificationsService implements OnApplicationShutdown {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly retries = new EmailRetryQueue(this.logger);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailTransport,
    private readonly limiter: RateLimiter,
  ) {}

  /**
   * Fire-and-forget; never throws to callers. Nobody is waiting to hear that it
   * failed, so it is tried again later where that is safe.
   *
   * Invites are not: the person inviting is told at once and can send a new one,
   * which would leave an old email to arrive later with a dead link.
   */
  notify(event: CustomerNotification) {
    const key =
      event.type === 'JOB_STATUS' && event.importJobId
        ? `status:${event.importJobId}`
        : undefined;
    const ticket = key ? this.retries.supersede(key) : undefined;
    void this.deliver(event).catch((error: unknown) => {
      const label = `${event.type} customer=${event.customerId ?? 'none'}`;
      const later = this.retries.add(error, label, key, ticket);
      this.warn(event, error, later);
    });
  }

  onApplicationShutdown() {
    const dropped = this.retries.stop();
    if (dropped) {
      this.logger.warn(`${dropped} emails waiting to be retried were not sent`);
    }
  }

  /**
   * Emails a portal invite and says whether it went, so the person inviting
   * can be told. Invites have their own limits on the invite routes.
   */
  async sendPortalInvite(
    event: CustomerNotification & { type: 'PORTAL_INVITE'; inviteUrl: string },
  ): Promise<boolean> {
    try {
      return await this.deliver(event);
    } catch (error) {
      this.warn(event, error);
      return false;
    }
  }

  async sendStaffInvite(to: string, invite: StaffInviteEmail) {
    try {
      await this.email.deliver({ to, ...composeStaffInviteEmail(invite) });
      return true;
    } catch (error) {
      this.logger.warn(`Failed STAFF_INVITE: ${detailOf(error)}`);
      return false;
    }
  }

  private warn(event: CustomerNotification, error: unknown, later = false) {
    this.logger.warn(
      `Failed ${event.type} customer=${event.customerId ?? 'none'}: ${detailOf(error)}${
        later ? '. It will be tried again.' : ''
      }`,
    );
  }

  private async deliver(event: CustomerNotification): Promise<boolean> {
    if (!event.customerId) return false;

    const customer = await this.prisma.customer.findFirst({
      where: {
        id: event.customerId,
        organisationId: event.organisationId,
      },
      select: {
        email: true,
        firstName: true,
        lastName: true,
        organisation: {
          select: {
            name: true,
            settings: { select: { brandName: true } },
          },
        },
      },
    });
    if (!customer?.email) {
      this.logger.debug(
        `Skip ${event.type}: customer ${event.customerId} has no email`,
      );
      return false;
    }
    if (
      event.type !== 'PORTAL_INVITE' &&
      !this.limiter.take(
        `workspace-notifications:${event.organisationId}`,
        WORKSPACE_DAILY_NOTIFICATIONS,
        DAY_MS,
      )
    ) {
      throw new Error('This workspace has reached its daily email limit');
    }

    let jobReference: string | null = null;
    if (event.importJobId) {
      const job = await this.prisma.importJob.findFirst({
        where: {
          id: event.importJobId,
          organisationId: event.organisationId,
        },
        select: { reference: true },
      });
      jobReference = job?.reference ?? null;
    }

    const brandName =
      customer.organisation.settings?.brandName?.trim() ||
      customer.organisation.name;
    const portalUrl = `${this.webOrigin()}/portal`;
    const composed = composeCustomerEmail(
      {
        type: event.type,
        message: event.message,
        inviteUrl: event.inviteUrl,
        jobReference,
      },
      {
        customerName: customer.firstName || customer.lastName || 'there',
        brandName,
        portalUrl,
      },
    );

    const result = await this.email.deliver({
      to: customer.email,
      subject: composed.subject,
      text: composed.text,
      html: composed.html,
    });
    this.logger.log(
      `${event.type} via=${result.provider} customer=${event.customerId}${
        event.importJobId ? ` job=${event.importJobId}` : ''
      }`,
    );
    return true;
  }

  private webOrigin() {
    return this.config
      .get<string>('WEB_ORIGIN', 'http://localhost:5173')
      .replace(/\/$/, '');
  }
}

function detailOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
