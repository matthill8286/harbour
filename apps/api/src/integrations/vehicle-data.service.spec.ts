import { ConfigService } from '@nestjs/config';
import { VehicleDataService } from './vehicle-data.service';

describe('VehicleDataService', () => {
  const make = (env: Record<string, string | undefined>) =>
    new VehicleDataService({
      get: (key: string, fallback?: string) => env[key] ?? fallback,
    } as ConfigService);

  it('defaults to mock and returns seeded BMW data', async () => {
    const service = make({});
    expect(service.provider()).toBe('mock');
    await expect(service.lookup('kn19 xpl', true)).resolves.toMatchObject({
      make: 'BMW',
      model: 'M5',
      source: 'mock',
    });
  });

  it('returns the demo BMW M3 for RJ14 XOO', async () => {
    const service = make({});
    await expect(service.lookup('rj14xoo', true)).resolves.toMatchObject({
      registration: 'RJ14 XOO',
      make: 'BMW',
      model: 'M3',
      source: 'mock',
    });
  });

  it('returns an empty mock shell for unknown plates', async () => {
    const service = make({});
    await expect(service.lookup('ZZ99ZZZ', true)).resolves.toMatchObject({
      registration: 'ZZ99 ZZZ',
      make: null,
      source: 'mock',
    });
  });

  it('uses dvla only when a key is present', () => {
    expect(make({ VEHICLE_DATA_PROVIDER: 'dvla' }).provider()).toBe('mock');
    expect(
      make({
        VEHICLE_DATA_PROVIDER: 'dvla',
        DVLA_API_KEY: 'test-key',
      }).provider(),
    ).toBe('dvla');
  });

  it('returns only the registration where sample data is not allowed', async () => {
    const service = make({});
    expect(service.available(false)).toBe(false);
    await expect(service.lookup('kn19xpl', false)).resolves.toMatchObject({
      registration: 'KN19 XPL',
      vin: null,
      make: null,
      source: 'unavailable',
    });
  });

  it('is available to every workspace with a real provider', () => {
    const service = make({
      VEHICLE_DATA_PROVIDER: 'dvla',
      DVLA_API_KEY: 'test-key',
    });
    expect(service.available(false)).toBe(true);
  });
});
