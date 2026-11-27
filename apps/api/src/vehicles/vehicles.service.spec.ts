import { ConfigService } from '@nestjs/config';
import { AnprService } from '../integrations/anpr.service';
import { VehicleDataService } from '../integrations/vehicle-data.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { VehiclesService } from './vehicles.service';

const user = { organisationId: 'org-1' } as AuthUser;

function make(slug: string) {
  const config = {
    get: (key: string, fallback?: string) =>
      key === 'NODE_ENV' ? 'production' : fallback,
  } as ConfigService;
  const prisma = {
    organisation: { findUnique: jest.fn().mockResolvedValue({ slug }) },
  };
  const vehicleData = new VehicleDataService(config);
  return new VehiclesService(
    prisma as unknown as PrismaService,
    vehicleData,
    new AnprService(vehicleData, config),
    config,
  );
}

const photo = {
  originalname: 'photo.jpg',
  mimetype: 'image/jpeg',
  buffer: Buffer.from([0xff, 0xd8, 0xff]),
} as Express.Multer.File;

describe('VehiclesService in production with mock providers', () => {
  it('gives a real workspace no sample vehicle', async () => {
    const service = make('acme-1a2b3c');
    await expect(service.capabilities(user)).resolves.toEqual({
      lookup: false,
      scan: false,
    });
    await expect(service.lookup(user, 'KN19 XPL')).resolves.toMatchObject({
      make: null,
      source: 'unavailable',
    });
    await expect(service.scanPlate(user, photo)).rejects.toThrow(
      'Plate scanning is not available',
    );
  });

  it('keeps the demo workspaces working', async () => {
    const service = make('demo-imports');
    await expect(service.capabilities(user)).resolves.toEqual({
      lookup: true,
      scan: true,
    });
    await expect(service.scanPlate(user, photo)).resolves.toMatchObject({
      registration: 'KN19 XPL',
      source: 'mock',
    });
  });
});
