import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  composeCustomerEmail,
  type CustomerEmailEventType,
} from './customer-email';
import { EmailTransport } from './email-transport';

export type CustomerNotification = {
  type: CustomerEmailEventType;
  organisationId: string;
  customerId: string | null;
  importJobId?: string;
  message: string;
  inviteUrl?: string;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailTransport,
  ) {}

  /** Fire-and-forget; never throws to callers. */
  notify(event: CustomerNotification) {
    void this.deliver(event).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed ${event.type} customer=${event.customerId ?? 'none'}: ${detail}`,
      );
    });
  }

  private async deliver(event: CustomerNotification) {
    if (!event.customerId) return;

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
      return;
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

    const result = await this.email.send({
      to: customer.email,
      subject: composed.subject,
      text: composed.text,
      html: composed.html,
    });
    this.logger.log(
      `${event.type} via=${result.provider} to=${customer.email}${
        event.importJobId ? ` job=${event.importJobId}` : ''
      }`,
    );
  }

  private webOrigin() {
    return this.config
      .get<string>('WEB_ORIGIN', 'http://localhost:5173')
      .replace(/\/$/, '');
  }
}
