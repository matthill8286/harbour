import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboundStatusError, outboundCall } from './outbound-call';

/** A written answer can take a while. */
export const OPENAI_TIMEOUT_MS = 30_000;

export type AiProvider = 'log' | 'openai';

export type CompleteJsonInput<T = unknown> = {
  system: string;
  user: string;
  schemaHint: string;
  /** Returned when provider is log (no network). */
  logFallback?: T;
};

export type CompleteTextInput = {
  system: string;
  user: string;
  /** Returned when provider is log (no network). */
  logFallback: string;
};

/**
 * Shared AI adapter (mirrors EmailTransport).
 * Env: AI_PROVIDER=log|openai, OPENAI_API_KEY, optional OPENAI_MODEL (gpt-4o-mini).
 */
@Injectable()
export class AiTransport {
  private readonly logger = new Logger(AiTransport.name);

  constructor(private readonly config: ConfigService) {}

  provider(): AiProvider {
    const configured = this.config
      .get<string>('AI_PROVIDER', 'log')
      .trim()
      .toLowerCase();
    if (configured === 'openai' && this.openaiKey()) {
      return 'openai';
    }
    return 'log';
  }

  async completeJson<T = Record<string, unknown>>(
    input: CompleteJsonInput<T>,
  ): Promise<T> {
    const source = this.provider();
    if (source === 'log') {
      this.logger.log(
        `ai[log] json system=${JSON.stringify(input.system.slice(0, 80))}`,
      );
      if (input.logFallback !== undefined) {
        return input.logFallback;
      }
      return {} as T;
    }
    const content = await this.chatCompletion({
      system: `${input.system}\n\nRespond with JSON only matching: ${input.schemaHint}`,
      user: input.user,
      json: true,
    });
    try {
      return JSON.parse(content) as T;
    } catch {
      this.logger.warn('OpenAI returned non-JSON; using log fallback if any');
      if (input.logFallback !== undefined) {
        return input.logFallback;
      }
      throw new Error('OpenAI returned non-JSON');
    }
  }

  async completeText(
    input: CompleteTextInput,
  ): Promise<{ text: string; source: AiProvider }> {
    const source = this.provider();
    if (source === 'log') {
      this.logger.log(
        `ai[log] text system=${JSON.stringify(input.system.slice(0, 80))}`,
      );
      return { text: input.logFallback, source };
    }
    const text = await this.chatCompletion({
      system: input.system,
      user: input.user,
      json: false,
    });
    return { text: text.trim() || input.logFallback, source };
  }

  private openaiKey() {
    return this.config.get<string>('OPENAI_API_KEY')?.trim() || '';
  }

  private model() {
    return (
      this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini')?.trim() ||
      'gpt-4o-mini'
    );
  }

  private async chatCompletion(args: {
    system: string;
    user: string;
    json: boolean;
  }) {
    return outboundCall(this.logger, {
      service: 'OpenAI',
      url: 'https://api.openai.com/v1/chat/completions',
      timeoutMs: OPENAI_TIMEOUT_MS,
      unavailable:
        'The writing assistant is not answering. Please try again shortly.',
      init: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.openaiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model(),
          temperature: 0.4,
          ...(args.json ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            { role: 'system', content: args.system },
            { role: 'user', content: args.user },
          ],
        }),
      },
      read: async (response) => {
        if (!response.ok) throw new OutboundStatusError(response.status);
        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        return payload.choices?.[0]?.message?.content?.trim() ?? '';
      },
    });
  }
}

/** Alias used by parallel Harbour AI slices — keep in sync with AiTransport. */
export { AiTransport as AITransport };
