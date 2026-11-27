import { GpsProviderService } from '../integrations/gps-provider.service';
import { TrackingService } from './tracking.service';

const LONDON = { latitude: 51.5074, longitude: -0.1278 };
const LIMASSOL = { latitude: 34.7071, longitude: 33.0226 };

type FakeEvent = {
  id: string;
  trackerId?: string;
  latitude: number;
  longitude: number;
  recordedAt: Date;
  speed?: number;
};

function createPrisma(
  events: FakeEvent[],
  options: {
    provider?: string;
    systemKey?: string | null;
    slug?: string;
  } = {},
) {
  const {
    provider = 'generic',
    systemKey = 'uk-cyprus',
    slug = 'demo-imports',
  } = options;
  const state = {
    events: events.map((event) => ({ trackerId: 'trk-1', ...event })),
  };
  const sorted = (direction: 'asc' | 'desc', trackerId?: string) => {
    const rows = state.events
      .filter((event) => !trackerId || event.trackerId === trackerId)
      .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
    return direction === 'asc' ? rows : rows.reverse();
  };
  const prisma = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
    journey: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    locationEvent: {
      findMany: jest.fn(({ where }: { where: { trackerId: string } }) =>
        Promise.resolve(sorted('asc', where.trackerId)),
      ),
      findFirst: jest.fn(({ where }: { where: { trackerId?: string } }) =>
        Promise.resolve(sorted('desc', where.trackerId)[0] ?? null),
      ),
      deleteMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) => {
        const drop = new Set(where.id.in);
        state.events = state.events.filter((event) => !drop.has(event.id));
        return Promise.resolve({ count: drop.size });
      }),
      createMany: jest.fn(({ data }: { data: Omit<FakeEvent, 'id'>[] }) => {
        for (const row of data) {
          state.events.push({
            trackerId: 'trk-1',
            ...row,
            id: `evt-${state.events.length + 1}`,
          });
        }
        return Promise.resolve({ count: data.length });
      }),
    },
    tracker: { update: jest.fn().mockResolvedValue({}) },
    importJob: {
      findFirst: jest.fn().mockResolvedValue({
        vehicleId: 'veh-1',
        route: { systemKey },
        organisation: { slug },
        trackerAssignments: [{ trackerId: 'trk-1', tracker: { provider } }],
      }),
    },
  };
  // The transaction hands the same fake to the work done inside it.
  prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
    work(prisma),
  );
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
    expect(prisma.locationEvent.createMany).not.toHaveBeenCalled();
    expect(prisma.tracker.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastSeenAt: new Date('2026-08-23T09:32:00Z'),
        }),
      }),
    );
  });

  it('never loads a trail for a live Flespi unit', async () => {
    const { prisma, state } = createPrisma(
      [
        {
          id: 'cy',
          ...LIMASSOL,
          recordedAt: new Date('2026-08-23T23:10:00Z'),
          speed: 42,
        },
      ],
      { provider: 'flespi' },
    );
    await service(prisma).alignToStatus(
      'job-1',
      'org-1',
      'READY_FOR_COLLECTION',
    );
    expect(prisma.locationEvent.deleteMany).not.toHaveBeenCalled();
    expect(prisma.locationEvent.findMany).not.toHaveBeenCalled();
    expect(prisma.locationEvent.findFirst).not.toHaveBeenCalled();
    expect(prisma.locationEvent.createMany).not.toHaveBeenCalled();
    expect(state.events.map((event) => event.id)).toEqual(['cy']);
  });

  it('invents and removes nothing outside the demo workspaces', async () => {
    const { prisma, state } = createPrisma(
      [
        {
          id: 'cy',
          ...LIMASSOL,
          recordedAt: new Date('2026-08-23T23:10:00Z'),
        },
      ],
      { slug: 'real-customer' },
    );
    await service(prisma).alignToStatus(
      'job-1',
      'org-1',
      'READY_FOR_COLLECTION',
    );
    // Journeys still follow the status.
    expect(prisma.journey.findMany).toHaveBeenCalled();
    expect(prisma.locationEvent.findMany).not.toHaveBeenCalled();
    expect(prisma.locationEvent.deleteMany).not.toHaveBeenCalled();
    expect(prisma.locationEvent.createMany).not.toHaveBeenCalled();
    expect(state.events).toHaveLength(1);
  });

  it('leaves another tracker’s points when trimming the simulated trail', async () => {
    const { prisma, state } = createPrisma([
      {
        id: 'real',
        trackerId: 'trk-real',
        ...LIMASSOL,
        recordedAt: new Date('2026-08-23T23:10:00Z'),
      },
    ]);
    await service(prisma).alignToStatus(
      'job-1',
      'org-1',
      'READY_FOR_COLLECTION',
    );
    expect(prisma.locationEvent.deleteMany).not.toHaveBeenCalled();
    expect(state.events.map((event) => event.id)).toContain('real');
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
    expect(prisma.locationEvent.createMany).toHaveBeenCalled();
    const last = state.events[state.events.length - 1];
    expect(last.latitude).toBeCloseTo(LIMASSOL.latitude, 3);
    expect(last.longitude).toBeCloseTo(LIMASSOL.longitude, 3);
  });

  it('leaves GPS alone for a job on a route other than UK → Cyprus', async () => {
    const { prisma, state } = createPrisma(
      [
        {
          id: 'cy',
          ...LIMASSOL,
          recordedAt: new Date('2026-08-23T23:10:00Z'),
          speed: 18,
        },
      ],
      { systemKey: null },
    );
    await service(prisma).alignToStatus(
      'job-1',
      'org-1',
      'READY_FOR_COLLECTION',
    );
    expect(prisma.locationEvent.deleteMany).not.toHaveBeenCalled();
    expect(state.events.map((event) => event.id)).toEqual(['cy']);
  });
});
