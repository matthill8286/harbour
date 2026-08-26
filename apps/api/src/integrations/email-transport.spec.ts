import { ConfigService } from '@nestjs/config';
import { EmailTransport } from './email-transport';

describe('EmailTransport', () => {
  const make = (env: Record<string, string | undefined>) =>
    new EmailTransport({
      get: (key: string, fallback?: string) =>
        env[key] ?? fallback,
    } as ConfigService);

  it('defaults to log', () => {
    expect(make({}).provider()).toBe('log');
  });

  it('uses resend only when a key is present', () => {
    expect(
      make({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test' }).provider(),
    ).toBe('resend');
    expect(make({ EMAIL_PROVIDER: 'resend' }).provider()).toBe('log');
  });

  it('logs instead of calling Resend when provider is log', async () => {
    const transport = make({});
    await expect(
      transport.send({
        to: 'maria@example.com',
        subject: 'Hello',
        text: 'Hi',
        html: '<p>Hi</p>',
      }),
    ).resolves.toEqual({ provider: 'log' });
  });
});
