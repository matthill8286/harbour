import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type OutboundEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

@Injectable()
export class EmailTransport {
  private readonly logger = new Logger(EmailTransport.name);

  constructor(private readonly config: ConfigService) {}

  provider(): 'log' | 'resend' {
    const configured = this.config
      .get<string>('EMAIL_PROVIDER', 'log')
      .trim()
      .toLowerCase();
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

  async send(email: OutboundEmail) {
    const provider = this.provider();
    if (provider === 'resend') {
      await this.sendResend(email);
      return { provider };
    }
    this.logger.log(
      `email[log] to=${email.to} subject=${JSON.stringify(email.subject)}`,
    );
    this.logger.debug(email.text);
    return { provider };
  }

  private resendKey() {
    return this.config.get<string>('RESEND_API_KEY')?.trim() || '';
  }

  private async sendResend(email: OutboundEmail) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.resendKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.fromAddress(),
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      this.logger.warn(`Resend ${response.status}: ${detail.slice(0, 240)}`);
      throw new Error(`Resend returned ${response.status}`);
    }
  }
}
