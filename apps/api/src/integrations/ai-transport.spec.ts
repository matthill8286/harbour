import { ConfigService } from '@nestjs/config';
import { AiTransport } from './ai-transport';

describe('AiTransport', () => {
  const make = (env: Record<string, string | undefined>) =>
    new AiTransport({
      get: (key: string, fallback?: string) => env[key] ?? fallback,
    } as ConfigService);

  it('defaults to log', () => {
    expect(make({}).provider()).toBe('log');
  });

  it('uses openai only when a key is present', () => {
    expect(
      make({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' }).provider(),
    ).toBe('openai');
    expect(make({ AI_PROVIDER: 'openai' }).provider()).toBe('log');
  });

  it('returns logFallback for completeText without network', async () => {
    const transport = make({});
    await expect(
      transport.completeText({
        system: 'Draft a note',
        user: 'intent',
        logFallback: 'Hello from template',
      }),
    ).resolves.toEqual({ text: 'Hello from template', source: 'log' });
  });

  it('returns logFallback for completeJson without network', async () => {
    const transport = make({});
    await expect(
      transport.completeJson({
        system: 'Pick one',
        user: 'context',
        schemaHint: '{ "id": string }',
        logFallback: { id: 'central' },
      }),
    ).resolves.toEqual({ id: 'central' });
  });
});
