import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseFlespiBatch, type FlespiPing } from './flespi-message';

@Injectable()
export class FlespiGpsClient {
  private readonly logger = new Logger(FlespiGpsClient.name);

  constructor(private readonly config: ConfigService) {}

  configured() {
    return Boolean(this.token());
  }

  async latestForImei(imei: string, count = 50): Promise<FlespiPing[]> {
    const token = this.token();
    if (!token) {
      throw new Error('FLESPI_TOKEN is not set');
    }
    const base = this.config
      .get<string>('FLESPI_API_BASE', 'https://flespi.io')
      .replace(/\/$/, '');
    const selector = encodeURIComponent(`ident='${imei.replace(/'/g, '')}'`);
    const url = `${base}/gw/devices/${selector}/messages?data=${encodeURIComponent(JSON.stringify({ count, reverse: true }))}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `FlespiToken ${token}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      const detail = await response.text();
      this.logger.warn(
        `Flespi messages ${response.status}: ${detail.slice(0, 240)}`,
      );
      throw new Error(`Flespi returned ${response.status}`);
    }
    const payload = (await response.json()) as { result?: unknown };
    return parseFlespiBatch(payload.result ?? payload);
  }

  private token() {
    return this.config.get<string>('FLESPI_TOKEN')?.trim() || '';
  }
}
