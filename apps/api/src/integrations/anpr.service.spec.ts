import { ConfigService } from '@nestjs/config';
import { AnprService } from './anpr.service';
import { VehicleDataService } from './vehicle-data.service';

describe('AnprService', () => {
  const vehicleData = {
    lookup: jest.fn((registration: string) =>
      Promise.resolve({
        registration,
        vin: null,
        make: 'BMW',
        model: 'M5',
        variant: null,
        year: 2019,
        colour: null,
        fuelType: null,
        engineSize: null,
        bodyType: null,
        mileage: null,
        countryOfRegistration: 'GB',
        source: 'mock',
      }),
    ),
  };

  const make = (env: Record<string, string | undefined>) =>
    new AnprService(
      vehicleData as unknown as VehicleDataService,
      {
        get: (key: string, fallback?: string) => env[key] ?? fallback,
      } as ConfigService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads a plate from the filename in mock mode', async () => {
    const result = await make({}).recognise(
      { originalName: 'lf21trk.jpg' },
      true,
    );
    expect(result).toMatchObject({
      registration: 'LF21 TRK',
      source: 'mock',
      confidence: 0.92,
    });
    expect(vehicleData.lookup).toHaveBeenCalledWith('LF21 TRK', true);
  });

  it('falls back to the seeded BMW plate when the filename is not a plate', async () => {
    const result = await make({}).recognise(
      { originalName: 'photo.jpg' },
      true,
    );
    expect(result.registration).toBe('KN19 XPL');
    expect(result.confidence).toBe(0.55);
  });

  it('uses platerecognizer only when a key is present', () => {
    expect(make({ ANPR_PROVIDER: 'platerecognizer' }).provider()).toBe('mock');
    expect(
      make({
        ANPR_PROVIDER: 'platerecognizer',
        PLATE_RECOGNIZER_API_KEY: 'tok',
      }).provider(),
    ).toBe('platerecognizer');
  });

  it('refuses to guess a plate where sample data is not allowed', async () => {
    const service = make({});
    expect(service.available(false)).toBe(false);
    await expect(
      service.recognise({ originalName: 'lf21trk.jpg' }, false),
    ).rejects.toThrow('Plate scanning is not available');
    expect(vehicleData.lookup).not.toHaveBeenCalled();
  });
});
