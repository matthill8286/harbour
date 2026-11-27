import { Logger } from '@nestjs/common';
import { EmailSendError, type EmailResult } from './email-transport';

/** The waits before each later try: about two and a half hours in all. */
export const LATER_RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
];
/** More waiting emails than this means the provider is down. */
export const MAX_WAITING = 200;

type Retry = () => Promise<EmailResult>;

type Waiting = { timer: NodeJS.Timeout; key: string };

/**
 * Emails to try again later. It takes only the `retry` of an `EmailSendError`,
 * which exists only when trying again cannot deliver the email twice.
 *
 * Held in memory: Harbour runs one API process, as the daily limit assumes too.
 * A restart drops what is waiting, and says how many. Saving them would put
 * customers' notes in a second table to be kept safe and cleared out.
 */
export class EmailRetryQueue {
  private readonly waiting = new Set<Waiting>();
  /** The newest email for each key, so an older one is never sent after it. */
  private readonly newest = new Map<string, number>();
  private sequence = 0;
  private stopped = false;

  constructor(private readonly logger: Logger) {}

  /**
   * A new email that replaces any earlier one with the same key: a job's older
   * status must not arrive after its newer one. Returns what `add` needs.
   */
  supersede(key: string): number {
    for (const item of this.waiting) {
      if (item.key === key) this.forget(item);
    }
    this.sequence += 1;
    this.newest.set(key, this.sequence);
    return this.sequence;
  }

  /** True when the failed email will be tried again. */
  add(
    error: unknown,
    label: string,
    key?: string,
    ticket?: number,
    attempt = 0,
  ): boolean {
    const retry: Retry | undefined =
      error instanceof EmailSendError ? error.retry : undefined;
    const delay = LATER_RETRY_DELAYS_MS[attempt];
    if (!retry || delay === undefined || this.stopped) return false;
    if (key !== undefined && this.newest.get(key) !== ticket) return false;
    if (this.waiting.size >= MAX_WAITING) return false;
    const item: Waiting = {
      key: key ?? '',
      timer: setTimeout(() => {
        this.waiting.delete(item);
        void retry().then(
          () => this.logger.log(`Sent ${label} on a later try`),
          (failure: unknown) => {
            if (!this.add(failure, label, key, ticket, attempt + 1)) {
              this.logger.error(`Gave up on ${label}: ${reason(failure)}`);
            }
          },
        );
      }, delay),
    };
    item.timer.unref();
    this.waiting.add(item);
    return true;
  }

  get size() {
    return this.waiting.size;
  }

  /** Cancels everything waiting and says how many there were. */
  stop(): number {
    this.stopped = true;
    const dropped = this.waiting.size;
    for (const item of this.waiting) this.forget(item);
    return dropped;
  }

  private forget(item: Waiting) {
    clearTimeout(item.timer);
    this.waiting.delete(item);
  }
}

function reason(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
