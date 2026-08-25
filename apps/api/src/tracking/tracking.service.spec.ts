import { GpsProviderService } from '../integrations/gps-provider.service';
import { TrackingService } from './tracking.service';

const LONDON = { latitude: 51.5074, longitude: -0.1278 };
const LIMASSOL = { latitude: 34.7071, longitude: 33.0226 };

type FakeEvent = {
  id: string;
  latitude: number;
  longitude: number;
  recordedAt: Date;
  speed?: number;
};

function createPrisma(events: FakeEvent[], provider = 'generic') {
  const state = { events: [...events] };
  const prisma = {
    journey: { findMany: jest.fn().mockResolvedValue([]) },
    locationEvent: {
      deleteMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) => {
        const drop = new Set(where.id.in);
        state.events = state.events.filter((event) => !drop.has(event.id));
        return Promise.resolve({ count: drop.size });
      }),
      create: jest.fn(
        ({ data }: { data: FakeEvent & { recordedAt: Date } }) => {
          const created = {
            ...data,
            id: data.id ?? `evt-${state.events.length + 1}`,
          };
          state.events.push(created);
          return Promise.resolve(created);
        },
      ),
    },
    tracker: { update: jest.fn().mockResolvedValue({}) },
    importJob: {
      findFirst: jest.fn(
        ({
          include,
        }: {
          include?: {
            locationEvents?: {
              take?: number;
              orderBy?: { recordedAt: string };
            };
          };
        }) => {
          const order = include?.locationEvents?.orderBy?.recordedAt ?? 'asc';
          const take = include?.locationEvents?.take;
          const sorted = [...state.events].sort(
            (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
          );
          const locationEvents =
            order === 'desc' ? [...sorted].reverse() : sorted;
          return Promise.resolve({
            id: 'job-1',
            organisationId: 'org-1',
            vehicleId: 'veh-1',
            status: 'READY_FOR_COLLECTION',
            trackerAssignments: [
              {
                trackerId: 'trk-1',
                tracker: {
                  id: 'trk-1',
                  provider,
                  batteryLevel: 80,
                  status: 'ASSIGNED',
                },
              },
            ],
            locationEvents: take
              ? locationEvents.slice(0, take)
              : locationEvents,
          });
        },
      ),
    },
  };
  return { prisma, state };
}

function service(prisma: object) {
  return new TrackingService(prisma as never, new GpsProviderService(), {
    getConfig: () => ({}),
  } as never);
}

describe('TrackingService.alignToStatus', () => {
  it('trims a Cyprus ping when a simulated job is still in the UK', async () => {
    const { prisma, state } = createPrisma([
      {
        id: 'uk',
        ...LONDON,
        recordedAt: new Date('2026-08-23T09:32:00Z'),
        speed: 72,
      },
      {
        id: 'cy',
        ...LIMASSOL,
        recordedAt: new Date('2026-08-23T23:10:00Z'),
        speed: 18,
      },
    ]);
    await service(prisma).alignToStatus(
      'job-1',
      'org-1',
      'READY_FOR_COLLECTION',
    );
    expect(prisma.locationEvent.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['cy'] } },
    });
    expect(state.events.map((event) => event.id)).toEqual(['uk']);
    expect(prisma.locationEvent.create).not.toHaveBeenCalled();
    expect(prisma.tracker.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastSeenAt: new Date('2026-08-23T09:32:00Z'),
        }),
      }),
    );
  });

  it('does not invent or delete corridor points for a live Flespi unit', async () => {
    const { prisma, state } = createPrisma(
      [
        {
          id: 'cy',
          ...LIMASSOL,
          recordedAt: new Date('2026-08-23T23:10:00Z'),
          speed: 42,
        },
      ],
      'flespi',
    );
    await service(prisma).alignToStatus(
      'job-1',
      'org-1',
      'READY_FOR_COLLECTION',
    );
    expect(prisma.locationEvent.deleteMany).not.toHaveBeenCalled();
    expect(prisma.locationEvent.create).not.toHaveBeenCalled();
    expect(state.events.map((event) => event.id)).toEqual(['cy']);
  });

  it('trims a Cyprus ping even when it is not the newest trail event', async () => {
    const { prisma, state } = createPrisma([
      {
        id: 'uk',
        ...LONDON,
        recordedAt: new Date('2026-08-23T09:32:00Z'),
        speed: 72,
      },
      {
        id: 'cy',
        ...LIMASSOL,
        recordedAt: new Date('2026-08-23T23:10:00Z'),
        speed: 18,
      },
      {
        id: 'uk-later',
        ...LONDON,
        recordedAt: new Date('2026-08-24T08:00:00Z'),
        speed: 0,
      },
    ]);
    await service(prisma).alignToStatus(
      'job-1',
      'org-1',
      'READY_FOR_COLLECTION',
    );
    expect(prisma.locationEvent.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['cy'] } },
    });
    expect(state.events.map((event) => event.id).sort()).toEqual([
      'uk',
      'uk-later',
    ]);
  });

  it('rebuilds up to Limassol when a simulated job has arrived in Cyprus', async () => {
    const { prisma, state } = createPrisma([
      {
        id: 'uk',
        ...LONDON,
        recordedAt: new Date('2026-08-23T09:32:00Z'),
        speed: 72,
      },
    ]);
    await service(prisma).alignToStatus('job-1', 'org-1', 'ARRIVED_CYPRUS');
    expect(prisma.locationEvent.deleteMany).not.toHaveBeenCalled();
    expect(prisma.locationEvent.create).toHaveBeenCalled();
    const last = state.events[state.events.length - 1];
    expect(last.latitude).toBeCloseTo(LIMASSOL.latitude, 3);
    expect(last.longitude).toBeCloseTo(LIMASSOL.longitude, 3);
  });
});
