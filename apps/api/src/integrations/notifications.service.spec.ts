import { ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { EmailTransport } from './email-transport';
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
    { send } as unknown as EmailTransport,
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
