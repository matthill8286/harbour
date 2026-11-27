/**
 * Each outside service is given a time limit, and one that does not answer
 * becomes a plain 503. Nothing is really sent.
 */
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiTransport, OPENAI_TIMEOUT_MS } from './ai-transport';
import { AnprService, PLATE_RECOGNIZER_TIMEOUT_MS } from './anpr.service';
import { FLESPI_TIMEOUT_MS, FlespiGpsClient } from './flespi-gps.client';
import { DVLA_TIMEOUT_MS, VehicleDataService } from './vehicle-data.service';

const config = {
  get: (key: string, fallback?: string) =>
    ({
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'k',
      VEHICLE_DATA_PROVIDER: 'dvla',
      DVLA_API_KEY: 'k',
      ANPR_PROVIDER: 'platerecognizer',
      PLATE_RECOGNIZER_API_KEY: 'k',
      FLESPI_TOKEN: 'k',
    })[key] ?? fallback,
} as ConfigService;

const vehicles = new VehicleDataService(config);

const calls: Array<[string, number, () => Promise<unknown>]> = [
  [
    'OpenAI',
    OPENAI_TIMEOUT_MS,
    () =>
      new AiTransport(config).completeText({
        system: 's',
        user: 'u',
        logFallback: 'f',
      }),
  ],
  ['DVLA', DVLA_TIMEOUT_MS, () => vehicles.lookup('AB12 CDE', false)],
  [
    'Flespi',
    FLESPI_TIMEOUT_MS,
    () => new FlespiGpsClient(config).latestForImei('356307042441013'),
  ],
  [
    'Plate Recognizer',
    PLATE_RECOGNIZER_TIMEOUT_MS,
    () =>
      new AnprService(vehicles, config).recognise(
        { originalName: 'a.jpg', buffer: Buffer.from('x') },
        false,
      ),
  ],
];

describe.each(calls)('a call to %s', (service, limit, call) => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it(`is given up after ${limit} ms, and answers 503`, async () => {
    const timer = jest.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException('timed out', 'TimeoutError')),
        5,
      );
      return controller.signal;
    });
    // A service that never answers.
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init!.signal!;
          signal.addEventListener('abort', () =>
            reject(signal.reason as Error),
          );
        }),
    );
    await expect(call()).rejects.toThrow(ServiceUnavailableException);
    expect(timer).toHaveBeenCalledWith(limit);
    expect(warn).toHaveBeenCalledWith(`${service} failed: no answer in time`);
  });

  it('logs only the status of a refusal', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('detail about AB12CDE'),
    } as unknown as Response);
    await expect(call()).rejects.toThrow(ServiceUnavailableException);
    expect(warn.mock.calls).toEqual([[`${service} failed: HTTP 500`]]);
  });
});
