import { Logger, ServiceUnavailableException } from '@nestjs/common';

type OutboundCall<T> = {
  /** The service's name, for the log. */
  service: string;
  url: string;
  init: RequestInit;
  timeoutMs: number;
  /** What the person waiting is told when the service does not answer. */
  unavailable: string;
  /** Reads the answer, within the same time limit. */
  read: (response: Response) => Promise<T>;
};

/**
 * A call to another company's service. It cannot hang, and a failure becomes a
 * 503. Only the service and the kind of failure are logged: the address and the
 * answer can hold a registration, an IMEI or a key.
 */
export async function outboundCall<T>(
  logger: Logger,
  call: OutboundCall<T>,
): Promise<T> {
  try {
    const response = await fetch(call.url, {
      ...call.init,
      signal: AbortSignal.timeout(call.timeoutMs),
    });
    return await call.read(response);
  } catch (error) {
    logger.warn(`${call.service} failed: ${failureKind(error)}`);
    throw new ServiceUnavailableException(call.unavailable);
  }
}

/** For an answer that is not a success. */
export class OutboundStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'OutboundStatusError';
  }
}

function failureKind(error: unknown): string {
  if (error instanceof OutboundStatusError) return error.message;
  const { name, cause } = error as {
    name?: string;
    cause?: { code?: unknown };
  };
  if (name === 'TimeoutError') return 'no answer in time';
  return typeof cause?.code === 'string' ? cause.code : (name ?? 'error');
}
