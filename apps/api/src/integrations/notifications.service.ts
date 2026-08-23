import { Injectable, Logger } from '@nestjs/common';

export type CustomerNotification = {
  type: 'JOB_STATUS' | 'CUSTOMER_NOTE' | 'FILE_SHARED' | 'PORTAL_INVITE';
  importJobId?: string;
  customerId: string | null;
  message: string;
};

/** Log-only adapter. Swap this implementation for email/SMS without changing callers. */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  notify(event: CustomerNotification) {
    if (!event.customerId) return;
    const job = event.importJobId ? ` job=${event.importJobId}` : '';
    this.logger.log(`${event.type}${job} customer=${event.customerId} ${event.message}`);
  }
}
