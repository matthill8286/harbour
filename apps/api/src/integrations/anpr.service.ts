import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VehicleDataService } from './vehicle-data.service';
import {
  formatUkRegistration,
  plateFromFilename,
} from './vehicle-registration';

export type AnprRecognition = {
  registration: string;
  confidence: number;
  lookup: Awaited<ReturnType<VehicleDataService['lookup']>>;
  source: 'mock' | 'platerecognizer';
};

type PlateRecognizerResult = {
  results?: Array<{
    plate?: string;
    score?: number;
  }>;
};

@Injectable()
export class AnprService {
  private readonly logger = new Logger(AnprService.name);

  constructor(
    private readonly vehicleData: VehicleDataService,
    private readonly config: ConfigService,
  ) {}

  provider(): 'mock' | 'platerecognizer' {
    const configured = this.config
      .get<string>('ANPR_PROVIDER', 'mock')
      .trim()
      .toLowerCase();
    if (configured === 'platerecognizer' && this.plateRecognizerKey()) {
      return 'platerecognizer';
    }
    return 'mock';
  }

  async recognise(input: {
    originalName: string;
    buffer?: Buffer;
    mimeType?: string;
  }): Promise<AnprRecognition> {
    const provider = this.provider();
    if (provider === 'platerecognizer') {
      return this.recognisePlateRecognizer(input);
    }
    return this.recogniseMock(input.originalName);
  }

  private async recogniseMock(originalName: string): Promise<AnprRecognition> {
    const plate = plateFromFilename(originalName) ?? 'KN19XPL';
    const registration = formatUkRegistration(plate);
    return {
      registration,
      confidence: plateFromFilename(originalName) ? 0.92 : 0.55,
      lookup: await this.vehicleData.lookup(registration),
      source: 'mock',
    };
  }

  private async recognisePlateRecognizer(input: {
    originalName: string;
    buffer?: Buffer;
    mimeType?: string;
  }): Promise<AnprRecognition> {
    if (!input.buffer?.length) {
      throw new Error('Plate image is required for ANPR');
    }
    const form = new FormData();
    const blob = new Blob([new Uint8Array(input.buffer)], {
      type: input.mimeType || 'application/octet-stream',
    });
    form.append('upload', blob, input.originalName || 'plate.jpg');
    const response = await fetch(
      'https://api.platerecognizer.com/v1/plate-reader/',
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.plateRecognizerKey()}`,
        },
        body: form,
      },
    );
    if (!response.ok) {
      const detail = await response.text();
      this.logger.warn(
        `Plate Recognizer ${response.status}: ${detail.slice(0, 240)}`,
      );
      throw new Error(`Plate recognition returned ${response.status}`);
    }
    const payload = (await response.json()) as PlateRecognizerResult;
    const best = [...(payload.results ?? [])].sort(
      (a, b) => (b.score ?? 0) - (a.score ?? 0),
    )[0];
    if (!best?.plate) {
      throw new Error('No registration plate detected in the image');
    }
    const registration = formatUkRegistration(best.plate);
    return {
      registration,
      confidence: typeof best.score === 'number' ? best.score : 0,
      lookup: await this.vehicleData.lookup(registration),
      source: 'platerecognizer',
    };
  }

  private plateRecognizerKey() {
    return this.config.get<string>('PLATE_RECOGNIZER_API_KEY')?.trim() || '';
  }
}
