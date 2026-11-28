import {
  DEFAULT_DESTINATION,
  DEFAULT_NEAR_DESTINATION_METERS,
  buildNearDestinationAlert,
  buildStaleTrackerAlert,
  haversineMeters,
  isNearDestination,
  parsePositiveNumber,
  routeDestination,
} from './ops-alerts';
import {
  describeMinutes,
  noSignalAfterMinutes,
  trackerSignal,
} from '@vip/shared';

describe('parsePositiveNumber', () => {
  it('falls back for empty or invalid values', () => {
    expect(parsePositiveNumber(undefined, 10)).toBe(10);
    expect(parsePositiveNumber('', 10)).toBe(10);
    expect(parsePositiveNumber('abc', 10)).toBe(10);
    expect(parsePositiveNumber('-5', 10)).toBe(10);
    expect(parsePositiveNumber('0', 10)).toBe(10);
  });

  it('parses positive numbers', () => {
    expect(parsePositiveNumber('7200000', 1)).toBe(7_200_000);
    expect(parsePositiveNumber('2500.5', DEFAULT_NEAR_DESTINATION_METERS)).toBe(
      2500.5,
    );
  });
});

describe('trackerSignal', () => {
  const now = new Date('2026-08-27T12:00:00Z');
  const at = (iso: string) => new Date(iso);

  it('says a unit that never reported has never reported', () => {
    expect(trackerSignal({ lastSeenAt: null }, now).state).toBe('NEVER');
  });

  it('allows two missed reports at the unit’s own interval', () => {
    const hourly = { reportIntervalMinutes: 60 };
    expect(
      trackerSignal({ ...hourly, lastSeenAt: at('2026-08-27T10:01:00Z') }, now)
        .state,
    ).toBe('LIVE');
    expect(
      trackerSignal({ ...hourly, lastSeenAt: at('2026-08-27T10:00:00Z') }, now)
        .state,
    ).toBe('NO_SIGNAL');
  });

  it('gives a unit that reports twice a day a full day', () => {
    const signal = trackerSignal(
      {
        reportIntervalMinutes: 12 * 60,
        lastSeenAt: at('2026-08-26T13:00:00Z'),
      },
      now,
    );
    expect(signal).toEqual({
      state: 'LIVE',
      lastSeenAt: '2026-08-26T13:00:00.000Z',
      noSignalAfterMinutes: 24 * 60,
    });
    expect(describeMinutes(signal.noSignalAfterMinutes)).toBe('1 day');
  });

  it('never calls a gap under half an hour silence', () => {
    expect(noSignalAfterMinutes(1)).toBe(30);
    expect(noSignalAfterMinutes(null)).toBe(120);
  });

  it('treats a unit marked offline as silent', () => {
    expect(
      trackerSignal(
        { status: 'OFFLINE', lastSeenAt: at('2026-08-27T11:59:00Z') },
        now,
      ).state,
    ).toBe('NO_SIGNAL');
  });
});

describe('routeDestination', () => {
  it('uses the last waypoint from a route template', () => {
    expect(
      routeDestination([
        { label: 'London', latitude: 51.5, longitude: -0.1 },
        { label: 'Limassol Port', latitude: 34.65, longitude: 33.02 },
      ]),
    ).toEqual({
      label: 'Limassol Port',
      latitude: 34.65,
      longitude: 33.02,
    });
  });

  it('falls back to default Limassol when waypoints are missing', () => {
    expect(routeDestination(null)).toEqual(DEFAULT_DESTINATION);
    expect(routeDestination([])).toEqual(DEFAULT_DESTINATION);
  });
});

describe('haversineMeters / isNearDestination', () => {
  const limassol = DEFAULT_DESTINATION;

  it('measures roughly zero at the same point', () => {
    expect(haversineMeters(limassol, limassol)).toBeLessThan(1);
  });

  it('alerts when a ping is inside the radius before ARRIVED_CYPRUS', () => {
    expect(
      isNearDestination({
        status: 'SHIPPING_TO_CYPRUS',
        current: {
          latitude: limassol.latitude + 0.01,
          longitude: limassol.longitude,
        },
        destination: limassol,
        radiusMeters: DEFAULT_NEAR_DESTINATION_METERS,
      }),
    ).toBe(true);
  });

  it('does not alert once status is ARRIVED_CYPRUS or later', () => {
    expect(
      isNearDestination({
        status: 'ARRIVED_CYPRUS',
        current: limassol,
        destination: limassol,
        radiusMeters: DEFAULT_NEAR_DESTINATION_METERS,
      }),
    ).toBe(false);
    expect(
      isNearDestination({
        status: 'COMPLETED',
        current: limassol,
        destination: limassol,
        radiusMeters: DEFAULT_NEAR_DESTINATION_METERS,
      }),
    ).toBe(false);
  });

  it('does not alert without a real ping', () => {
    expect(
      isNearDestination({
        status: 'SHIPPING_TO_CYPRUS',
        current: null,
        destination: limassol,
        radiusMeters: DEFAULT_NEAR_DESTINATION_METERS,
      }),
    ).toBe(false);
  });

  it('does not alert when far from destination', () => {
    expect(
      isNearDestination({
        status: 'AT_GREECE',
        current: { latitude: 37.942, longitude: 23.646 },
        destination: limassol,
        radiusMeters: DEFAULT_NEAR_DESTINATION_METERS,
      }),
    ).toBe(false);
  });
});

describe('alert builders', () => {
  it('builds actionable stale and near-destination copy', () => {
    expect(
      buildStaleTrackerAlert({
        importJobId: 'job-1',
        reference: 'CY-1',
        trackerSerial: 'TAT-1',
        lastSeenAt: null,
      }),
    ).toMatchObject({
      kind: 'STALE_TRACKER',
      importJobId: 'job-1',
      reference: 'CY-1',
    });

    expect(
      buildNearDestinationAlert({
        importJobId: 'job-2',
        reference: 'CY-2',
        destinationLabel: 'Limassol',
        distanceMeters: 1200,
      }),
    ).toMatchObject({
      kind: 'NEAR_DESTINATION',
      importJobId: 'job-2',
      detail: expect.stringContaining('1.2 km'),
    });
  });
});
