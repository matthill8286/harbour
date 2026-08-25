import { FlespiIngestService } from './flespi-ingest.service';

const ping = {
  ident: '352625333222111',
  'position.latitude': 34.6841,
  'position.longitude': 33.0379,
  'position.speed': 42,
  'position.direction': 180,
  'battery.level': 91,
  timestamp: 1_700_000_000,
};

function createService(prisma: object) {
  return new FlespiIngestService(
    prisma as never,
    { configured: () => false } as never,
  );
}

describe('FlespiIngestService', () => {
  it('writes a LocationEvent when the IMEI is assigned to a job', async () => {
    const prisma = {
      tracker: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'trk-1',
            organisationId: 'org-1',
            batteryLevel: 80,
            status: 'ASSIGNED',
            assignments: [{ vehicleId: 'veh-1', importJobId: 'job-1' }],
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      locationEvent: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      },
    };
    const result = await createService(prisma).ingestBody([ping]);
    expect(result).toEqual({
      received: 1,
      accepted: 1,
      skipped: 0,
      unknown: 0,
    });
    expect(prisma.locationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          importJobId: 'job-1',
          vehicleId: 'veh-1',
          latitude: 34.6841,
          longitude: 33.0379,
        }),
      }),
    );
    expect(prisma.tracker.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ batteryLevel: 91, status: 'ASSIGNED' }),
      }),
    );
  });

  it('heartbeats an unassigned unit without writing a job trail', async () => {
    const prisma = {
      tracker: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'trk-1',
            organisationId: 'org-1',
            batteryLevel: 80,
            status: 'AVAILABLE',
            assignments: [],
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      locationEvent: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    const result = await createService(prisma).ingestBody([ping]);
    expect(result.accepted).toBe(1);
    expect(prisma.locationEvent.create).not.toHaveBeenCalled();
    expect(prisma.tracker.update).toHaveBeenCalled();
  });

  it('skips unknown IMEIs so Flespi still gets 200', async () => {
    const prisma = {
      tracker: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      locationEvent: { findFirst: jest.fn(), create: jest.fn() },
    };
    const result = await createService(prisma).ingestBody([ping]);
    expect(result).toEqual({
      received: 1,
      accepted: 0,
      skipped: 0,
      unknown: 1,
    });
  });
});
