import { ConfigService } from '@nestjs/config';
import { EmailTransport } from './email-transport';

describe('EmailTransport', () => {
  const make = (env: Record<string, string | undefined>) =>
    new EmailTransport({
      get: (key: string, fallback?: string) => env[key] ?? fallback,
    } as ConfigService);

  afterEach(() => jest.restoreAllMocks());

  it('defaults to log', () => {
    expect(make({}).provider()).toBe('log');
  });

  it('uses resend only when a key is present', () => {
    expect(
      make({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test' }).provider(),
    ).toBe('resend');
    expect(make({ EMAIL_PROVIDER: 'resend' }).provider()).toBe('log');
  });

  it('sends the email through Brevo with its authenticated sender', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true } as Response);
    const transport = make({
      EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: 'test-key',
      EMAIL_FROM: 'Harbour <verified@example.com>',
    });
    await expect(
      transport.send({
        to: 'customer@example.com',
        subject: 'Update',
        text: 'Updated',
        html: '<p>Updated</p>',
      }),
    ).resolves.toEqual({ provider: 'brevo' });
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(request?.headers).toMatchObject({ 'api-key': 'test-key' });
    expect(JSON.parse(request?.body as string)).toMatchObject({
      sender: { name: 'Harbour', email: 'verified@example.com' },
      to: [{ email: 'customer@example.com' }],
      textContent: 'Updated',
    });
  });

  it('surfaces Brevo rejection without logging provider response data', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: false, status: 429 } as Response);
    await expect(
      make({ EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'test-key' }).send({
        to: 'customer@example.com',
        subject: 'Update',
        text: 'Updated',
        html: '',
      }),
    ).rejects.toThrow('Brevo returned 429');
    expect(make({ EMAIL_PROVIDER: 'brevo' }).provider()).toBe('log');
  });

  it('stops at the daily limit, so other products keep their share', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
    const transport = make({
      EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: 'test-key',
      EMAIL_DAILY_LIMIT: '2',
    });
    const email = { to: 'a@example.com', subject: 's', text: 't', html: '' };
    await transport.send(email);
    await transport.send(email);
    await expect(transport.send(email)).rejects.toThrow('daily email limit');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not count a logged email as delivered in production', async () => {
    const email = { to: 'a@example.com', subject: 's', text: 't', html: '' };
    const production = make({ NODE_ENV: 'production' });
    await expect(production.deliver(email)).rejects.toThrow(
      'No email provider',
    );
    expect(production.localDelivery()).toBe(false);
    expect(make({}).localDelivery()).toBe(true);
    await expect(make({}).deliver(email)).resolves.toEqual({ provider: 'log' });
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
