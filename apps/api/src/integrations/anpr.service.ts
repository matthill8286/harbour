import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboundStatusError, outboundCall } from './outbound-call';
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

/** The photo is uploaded within this time too. */
export const PLATE_RECOGNIZER_TIMEOUT_MS = 20_000;

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

  /** False when the only reader is the mock and this workspace may not see it. */
  available(sampleAllowed: boolean): boolean {
    return this.provider() !== 'mock' || sampleAllowed;
  }

  async recognise(
    input: {
      originalName: string;
      buffer?: Buffer;
      mimeType?: string;
    },
    sampleAllowed: boolean,
  ): Promise<AnprRecognition> {
    if (!this.available(sampleAllowed)) {
      // The mock guesses a plate, which could put the wrong car on a real job.
      throw new ServiceUnavailableException(
        'Plate scanning is not available. Type the registration instead.',
      );
    }
    if (this.provider() === 'platerecognizer') {
      return this.recognisePlateRecognizer(input, sampleAllowed);
    }
    return this.recogniseMock(input.originalName);
  }

  private async recogniseMock(originalName: string): Promise<AnprRecognition> {
    const plate = plateFromFilename(originalName) ?? 'KN19XPL';
    const registration = formatUkRegistration(plate);
    return {
      registration,
      confidence: plateFromFilename(originalName) ? 0.92 : 0.55,
      lookup: await this.vehicleData.lookup(registration, true),
      source: 'mock',
    };
  }

  private async recognisePlateRecognizer(
    input: {
      originalName: string;
      buffer?: Buffer;
      mimeType?: string;
    },
    sampleAllowed: boolean,
  ): Promise<AnprRecognition> {
    if (!input.buffer?.length) {
      throw new Error('Plate image is required for ANPR');
    }
    const form = new FormData();
    const blob = new Blob([new Uint8Array(input.buffer)], {
      type: input.mimeType || 'application/octet-stream',
    });
    form.append('upload', blob, input.originalName || 'plate.jpg');
    const payload = await outboundCall(this.logger, {
      service: 'Plate Recognizer',
      url: 'https://api.platerecognizer.com/v1/plate-reader/',
      timeoutMs: PLATE_RECOGNIZER_TIMEOUT_MS,
      unavailable:
        'Plate scanning is not answering. Type the registration instead.',
      init: {
        method: 'POST',
        headers: { Authorization: `Token ${this.plateRecognizerKey()}` },
        body: form,
      },
      read: async (response) => {
        if (!response.ok) throw new OutboundStatusError(response.status);
        return (await response.json()) as PlateRecognizerResult;
      },
    });
    const best = [...(payload.results ?? [])].sort(
      (a, b) => (b.score ?? 0) - (a.score ?? 0),
    )[0];
    if (!best?.plate) {
      throw new UnprocessableEntityException(
        'No registration plate was found in the photo. Type the registration instead.',
      );
    }
    const registration = formatUkRegistration(best.plate);
    return {
      registration,
      confidence: typeof best.score === 'number' ? best.score : 0,
      lookup: await this.vehicleData.lookup(registration, sampleAllowed),
      source: 'platerecognizer',
    };
  }

  private plateRecognizerKey() {
    return this.config.get<string>('PLATE_RECOGNIZER_API_KEY')?.trim() || '';
  }
}
