import type { LoggerService } from '@nestjs/common';
import { describeError, redact, stackFrames } from './redact';
import { currentRequestId } from './request-context';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * One JSON object on each line, for `docker logs`. Everything is redacted, and
 * debug lines are not written in production.
 */
export class AppLogger implements LoggerService {
  constructor(
    private readonly write: (level: LogLevel, line: string) => void = toStreams,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  log(message: unknown, ...params: unknown[]) {
    this.line('info', message, params);
  }

  warn(message: unknown, ...params: unknown[]) {
    this.line('warn', message, params);
  }

  error(message: unknown, ...params: unknown[]) {
    this.line('error', message, params);
  }

  fatal(message: unknown, ...params: unknown[]) {
    this.line('fatal', message, params);
  }

  debug(message: unknown, ...params: unknown[]) {
    if (this.env.NODE_ENV !== 'production') {
      this.line('debug', message, params);
    }
  }

  verbose(message: unknown, ...params: unknown[]) {
    this.debug(message, ...params);
  }

  private line(level: LogLevel, message: unknown, params: unknown[]) {
    const rest = params.filter((param) => param !== undefined);
    // Nest puts the logger's name last, after any stack or error.
    const last = rest[rest.length - 1];
    const context =
      typeof last === 'string' && !last.includes('\n') ? last : undefined;
    if (context !== undefined) rest.pop();

    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      ...(context ? { context } : {}),
      ...fields(message),
    };
    for (const param of rest) {
      if (param instanceof Error) entry.error = describeError(param);
      else if (typeof param === 'string' && /\n\s+at /.test(param)) {
        entry.stack = stackFrames(param);
      } else Object.assign(entry, { detail: redact(asText(param)) });
    }
    const requestId = currentRequestId();
    if (requestId) entry.requestId = requestId;
    this.write(level, JSON.stringify(entry));
  }
}

/** A structured message keeps its fields. Anything else becomes `msg`. */
function fields(message: unknown): Record<string, unknown> {
  if (message instanceof Error) {
    return { msg: message.name, error: describeError(message) };
  }
  if (!isStructured(message)) return { msg: redact(asText(message)) };
  return Object.fromEntries(
    Object.entries(message).map(([key, value]) => [
      key,
      // Made by this process, and as long as a token.
      key === 'requestId' ? value : redactDeep(value),
    ]),
  );
}

function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactDeep(item)]),
  );
}

function isStructured(value: unknown): value is { msg: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { msg?: unknown }).msg === 'string'
  );
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? String(value);
}

function toStreams(level: LogLevel, line: string) {
  const stream =
    level === 'error' || level === 'fatal' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}
