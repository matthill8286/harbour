import { ConfigService } from '@nestjs/config';
import {
  NotificationsService,
  WORKSPACE_DAILY_NOTIFICATIONS,
} from './notifications.service';
import { RateLimiter } from '../rate-limit/rate-limiter';
import { EmailSendError, EmailTransport } from './email-transport';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationsService', () => {
  const send = jest.fn().mockResolvedValue({ provider: 'log' });

  const prisma = {
    customer: {
      findFirst: jest.fn(),
    },
    importJob: {
      findFirst: jest.fn(),
    },
  };

  const service = new NotificationsService(
    prisma as unknown as PrismaService,
    {
      get: (_key: string, fallback?: string) => fallback,
    } as ConfigService,
    { deliver: send } as unknown as EmailTransport,
    new RateLimiter(),
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const deliver = (event: Parameters<NotificationsService['notify']>[0]) =>
    (
      service as unknown as {
        deliver: (e: typeof event) => Promise<void>;
      }
    ).deliver(event);

  it('skips when the customer has no email', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      email: null,
      firstName: 'Maria',
      lastName: 'Example',
      organisation: { name: 'Demo', settings: null },
    });

    await deliver({
      type: 'JOB_STATUS',
      organisationId: 'org-1',
      customerId: 'cust-1',
      importJobId: 'job-1',
      message: 'Your vehicle is now: Arrived',
    });

    expect(send).not.toHaveBeenCalled();
  });

  it('sends a composed status email', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      email: 'maria@example.com',
      firstName: 'Maria',
      lastName: 'Example',
      organisation: {
        name: 'Demo Imports Ltd',
        settings: { brandName: 'Demo Imports' },
      },
    });
    prisma.importJob.findFirst.mockResolvedValue({
      reference: 'CY-2026-00421',
    });

    await deliver({
      type: 'JOB_STATUS',
      organisationId: 'org-1',
      customerId: 'cust-1',
      importJobId: 'job-1',
      message: 'Your vehicle is now: Arrived',
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'maria@example.com',
        subject: 'Update on your vehicle (CY-2026-00421)',
      }),
    );
    expect(send.mock.calls[0][0].text).toContain(
      'Your vehicle is now: Arrived',
    );
  });

  const customer = {
    email: 'maria@example.com',
    firstName: 'Maria',
    lastName: 'Example',
    organisation: { name: 'Demo Imports Ltd', settings: null },
  };
  const portalInvite = (organisationId: string) => ({
    type: 'PORTAL_INVITE' as const,
    organisationId,
    customerId: 'cust-1',
    inviteUrl: 'http://localhost:5173/invite/tok',
    message: 'Portal invite',
  });

  it('says whether a portal invite went', async () => {
    prisma.customer.findFirst.mockResolvedValue(customer);
    await expect(service.sendPortalInvite(portalInvite('org-1'))).resolves.toBe(
      true,
    );
    send.mockRejectedValueOnce(new Error('Brevo returned 429'));
    await expect(service.sendPortalInvite(portalInvite('org-1'))).resolves.toBe(
      false,
    );
  });

  it('tries a failed notification again later, but never an invite', async () => {
    jest.useFakeTimers();
    prisma.customer.findFirst.mockResolvedValue(customer);
    const retry = jest.fn().mockResolvedValue({ provider: 'brevo' });
    const refusal = () =>
      Object.assign(new EmailSendError('Brevo returned 429', true), { retry });
    send.mockRejectedValueOnce(refusal()).mockRejectedValueOnce(refusal());

    await service.sendPortalInvite(portalInvite('org-retry'));
    service.notify({
      type: 'CUSTOMER_NOTE',
      organisationId: 'org-retry',
      customerId: 'cust-1',
      message: 'Hello',
    });
    await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    expect(retry).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('says whether a staff invite went', async () => {
    const invite = {
      brandName: 'Demo',
      roleLabel: 'Staff',
      inviteUrl: 'http://localhost:5173/invite/tok',
    };
    await expect(
      service.sendStaffInvite('sam@example.com', invite, 'org-1'),
    ).resolves.toBe(true);
    expect(send.mock.calls[0][0].text).toContain(invite.inviteUrl);
    send.mockRejectedValueOnce(new Error('provider down'));
    await expect(
      service.sendStaffInvite('sam@example.com', invite, 'org-1'),
    ).resolves.toBe(false);
  });

  it('stops one workspace at its daily limit without touching another', async () => {
    prisma.customer.findFirst.mockResolvedValue(customer);
    const note = (organisationId: string) => ({
      type: 'CUSTOMER_NOTE' as const,
      organisationId,
      customerId: 'cust-1',
      message: 'Hello',
    });
    for (let i = 0; i < WORKSPACE_DAILY_NOTIFICATIONS; i += 1) {
      await deliver(note('org-a'));
    }
    await expect(deliver(note('org-a'))).rejects.toThrow('daily email limit');
    await deliver(note('org-b'));
    expect(send).toHaveBeenCalledTimes(WORKSPACE_DAILY_NOTIFICATIONS + 1);
  });

  it('includes the invite URL for portal invites', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      email: 'maria@example.com',
      firstName: 'Maria',
      lastName: 'Example',
      organisation: { name: 'Demo Imports Ltd', settings: null },
    });

    await deliver({
      type: 'PORTAL_INVITE',
      organisationId: 'org-1',
      customerId: 'cust-1',
      inviteUrl: 'http://localhost:5173/invite/tok',
      message: 'Portal invite',
    });

    expect(send).toHaveBeenCalled();
    expect(send.mock.calls[0][0].text).toContain(
      'http://localhost:5173/invite/tok',
    );
  });
});
