import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimiter } from '../rate-limit/rate-limiter';

/**
 * Brevo's free allowance is 300 emails a day, shared with other products and
 * their alerts. Harbour stops here, so it cannot use all of it.
 */
export const DEFAULT_EMAIL_DAILY_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

/** How long one call to the email provider may take. */
export const EMAIL_TIMEOUT_MS = 15_000;
/** Tried again at once, while the caller waits. */
export const QUICK_RETRY_DELAYS_MS = [1_000, 3_000];

/**
 * Network failures from before the request left, so the provider never saw it.
 */
const NEVER_SENT = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

export type OutboundEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type EmailProvider = 'log' | 'resend' | 'brevo';
export type EmailResult = { provider: EmailProvider };

/**
 * The provider did not take the email. `retry` is set only when sending it again
 * cannot deliver it twice. It tries once more, as the same email: it uses no
 * more of the daily limit, and Resend gets the same idempotency key.
 */
export class EmailSendError extends Error {
  retry?: () => Promise<EmailResult>;

  constructor(
    message: string,
    readonly safeToRetry: boolean,
    readonly timedOut = false,
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}

@Injectable()
export class EmailTransport {
  private readonly logger = new Logger(EmailTransport.name);
  private readonly sent = new RateLimiter();
  retryDelaysMs = QUICK_RETRY_DELAYS_MS;

  constructor(private readonly config: ConfigService) {}

  provider(): EmailProvider {
    const configured = this.config
      .get<string>('EMAIL_PROVIDER', 'log')
      .trim()
      .toLowerCase();
    if (configured === 'brevo' && this.brevoKey()) {
      return 'brevo';
    }
    if (configured === 'resend' && this.resendKey()) {
      return 'resend';
    }
    return 'log';
  }

  fromAddress() {
    return (
      this.config
        .get<string>('EMAIL_FROM', 'Harbour <noreply@harbour.local>')
        .trim() || 'Harbour <noreply@harbour.local>'
    );
  }

  /**
   * Development without a mail provider. Nothing is sent, so the api may hand a
   * link to whoever is testing. Never true in production.
   */
  localDelivery() {
    return this.provider() === 'log' && !this.production();
  }

  /** Throws unless the email was handed on. In production, logging it is not. */
  async deliver(email: OutboundEmail) {
    if (this.provider() === 'log' && this.production()) {
      throw new Error('No email provider is configured');
    }
    return this.send(email);
  }

  private production() {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  private dailyLimit() {
    const configured = Number(this.config.get<string>('EMAIL_DAILY_LIMIT'));
    return Number.isInteger(configured) && configured > 0
      ? configured
      : DEFAULT_EMAIL_DAILY_LIMIT;
  }

  /**
   * Sends one email, trying again at once after a failure that is safe to repeat.
   * If it still fails that way, the error carries `retry` for later.
   */
  async send(email: OutboundEmail): Promise<EmailResult> {
    const attempt = this.attemptsFor(email);
    for (let tries = 0; ; tries += 1) {
      try {
        return await attempt();
      } catch (error) {
        if (!(error instanceof EmailSendError) || !error.safeToRetry) {
          throw error;
        }
        const delay = this.retryDelaysMs[tries];
        // After a timeout the caller has waited long enough.
        if (delay === undefined || error.timedOut) {
          error.retry = this.retryable(attempt);
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private retryable(attempt: () => Promise<EmailResult>) {
    const retry = async (): Promise<EmailResult> => {
      try {
        return await attempt();
      } catch (error) {
        if (error instanceof EmailSendError && error.safeToRetry) {
          error.retry = retry;
        }
        throw error;
      }
    };
    return retry;
  }

  /**
   * Every attempt at one email shares one place in the daily limit, so retries
   * cannot take Harbour past it. Only an email the provider cannot have accepted
   * is attempted again, so each place delivers one email at most.
   */
  private attemptsFor(email: OutboundEmail): () => Promise<EmailResult> {
    const idempotencyKey = randomUUID();
    let counted = false;
    return async () => {
      const provider = this.provider();
      if (provider === 'log') {
        this.logEmail(email);
        return { provider };
      }
      if (!counted) {
        if (!this.sent.take('all-email', this.dailyLimit(), DAY_MS)) {
          throw new EmailSendError(
            'Harbour has reached its daily email limit',
            false,
          );
        }
        counted = true;
      }
      if (provider === 'brevo') await this.sendBrevo(email);
      else await this.sendResend(email, idempotencyKey);
      return { provider };
    };
  }

  /**
   * No address, subject or text: the subject names people and workspaces, and
   * the text holds sign-in links.
   */
  private logEmail(email: OutboundEmail) {
    this.logger.log('email[log] nothing was sent');
    // For local testing only, where there is no other way to get a sign-up or
    // reset link. Off unless asked for, and never in production. It is printed
    // outside the logger, which would remove the links.
    if (
      !this.production() &&
      this.config.get<string>('EMAIL_PRINT_MESSAGES') === 'true'
    ) {
      process.stdout.write(
        `\nTo: ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n\n`,
      );
    }
  }

  private brevoKey() {
    return this.config.get<string>('BREVO_API_KEY')?.trim() || '';
  }

  private async sendBrevo(email: OutboundEmail) {
    const from = this.fromAddress();
    const match = /^(.*?)\s*<([^<>]+)>$/.exec(from);
    const sender = match
      ? { name: match[1].trim(), email: match[2].trim() }
      : { email: from };
    const response = await this.post(
      'Brevo',
      'https://api.brevo.com/v3/smtp/email',
      { 'api-key': this.brevoKey() },
      {
        sender,
        to: [{ email: email.to }],
        subject: email.subject,
        textContent: email.text,
        htmlContent: email.html,
      },
      // Brevo offers no way to say "this is the same email", so only a failure
      // to connect is certain not to have sent it.
      (cause) => cause !== undefined && NEVER_SENT.has(cause),
    );
    if (!response.ok) {
      // Provider responses can contain addresses or account details, so only
      // the status is kept. 429 means it was refused for now. After a server
      // error it may have been sent.
      throw new EmailSendError(
        `Brevo returned ${response.status}`,
        response.status === 429,
      );
    }
  }

  private resendKey() {
    return this.config.get<string>('RESEND_API_KEY')?.trim() || '';
  }

  private async sendResend(email: OutboundEmail, idempotencyKey: string) {
    const response = await this.post(
      'Resend',
      'https://api.resend.com/emails',
      {
        Authorization: `Bearer ${this.resendKey()}`,
        // Resend sends one email for each key, for 24 hours.
        'Idempotency-Key': idempotencyKey,
      },
      {
        from: this.fromAddress(),
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      },
      () => true,
    );
    if (!response.ok) {
      throw new EmailSendError(
        `Resend returned ${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }
  }

  private async post(
    name: string,
    url: string,
    headers: Record<string, string>,
    body: object,
    safeAfterNetworkFailure: (causeCode: string | undefined) => boolean,
  ) {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
      });
    } catch (error) {
      const { name: kind, cause } = error as {
        name?: string;
        cause?: { code?: unknown };
      };
      const code = typeof cause?.code === 'string' ? cause.code : undefined;
      const timedOut = kind === 'TimeoutError';
      throw new EmailSendError(
        timedOut
          ? `${name} did not answer in time`
          : `${name} could not be reached${code ? ` (${code})` : ''}`,
        safeAfterNetworkFailure(code),
        timedOut || code === 'UND_ERR_CONNECT_TIMEOUT',
      );
    }
  }
}
