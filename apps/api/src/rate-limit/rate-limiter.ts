import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RATE_LIMITS, type RateLimitPolicy } from './policies';

type Window = { count: number; resetsAt: number };

/** Stops made-up keys from using up the memory. The oldest windows go first. */
export const MAX_KEYS = 50_000;

export class TooManyRequestsException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    const minutes = Math.ceil(retryAfterSeconds / 60);
    const wait =
      minutes >= 120
        ? `${Math.ceil(minutes / 60)} hours`
        : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'rate_limited',
        message: `Too many attempts. Try again in ${wait}.`,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Counts attempts in fixed windows, held in memory. Harbour runs one API
 * process, so one count covers every request. A restart clears the counts.
 */
@Injectable()
export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  /** Takes one attempt, or throws when none are left. */
  consume(policy: RateLimitPolicy, key: string, now = Date.now()) {
    const { limit, windowMs } = RATE_LIMITS[policy];
    if (!this.take(`${policy}:${key}`, limit, windowMs, now)) {
      const window = this.windows.get(`${policy}:${key}`)!;
      throw new TooManyRequestsException(
        Math.max(1, Math.ceil((window.resetsAt - now) / 1000)),
      );
    }
  }

  /** The same for a limit that is set at run time. False when none are left. */
  take(id: string, limit: number, windowMs: number, now = Date.now()) {
    let window = this.windows.get(id);
    if (!window || window.resetsAt <= now) {
      this.makeRoom(now);
      window = { count: 0, resetsAt: now + windowMs };
      this.windows.delete(id);
      this.windows.set(id, window);
    }
    if (window.count >= limit) return false;
    window.count += 1;
    return true;
  }

  /** Forgets the attempts so far, as after a correct password. */
  reset(policy: RateLimitPolicy, key: string) {
    this.windows.delete(`${policy}:${key}`);
  }

  private makeRoom(now: number) {
    if (this.windows.size < MAX_KEYS) return;
    for (const [id, window] of this.windows) {
      if (window.resetsAt <= now) this.windows.delete(id);
    }
    for (const id of this.windows.keys()) {
      if (this.windows.size < MAX_KEYS) break;
      this.windows.delete(id);
    }
  }
}
