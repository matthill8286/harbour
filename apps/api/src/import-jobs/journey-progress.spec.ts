import {
  isDestinationReached,
  journeyStatusesForJob,
  remainingCorridorFrom,
  routeAnchorLabel,
} from '@vip/shared';

describe('journeyStatusesForJob', () => {
  it('keeps every leg planned before collection', () => {
    expect(journeyStatusesForJob('NEW')).toEqual([
      'PLANNED',
      'PLANNED',
      'PLANNED',
    ]);
    expect(journeyStatusesForJob('CONFIRMED')).toEqual([
      'PLANNED',
      'PLANNED',
      'PLANNED',
    ]);
  });

  it('does not mark the Cyprus crossing complete while still in Greece', () => {
    expect(journeyStatusesForJob('IN_TRANSIT_TO_GREECE')).toEqual([
      'COMPLETED',
      'IN_PROGRESS',
      'PLANNED',
    ]);
    expect(journeyStatusesForJob('AT_GREECE')).toEqual([
      'COMPLETED',
      'COMPLETED',
      'PLANNED',
    ]);
    expect(journeyStatusesForJob('SHIPPING_TO_CYPRUS')).toEqual([
      'COMPLETED',
      'COMPLETED',
      'IN_PROGRESS',
    ]);
  });

  it('completes every leg only after arrival in Cyprus', () => {
    expect(journeyStatusesForJob('ARRIVED_CYPRUS')).toEqual([
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
    ]);
    expect(journeyStatusesForJob('READY_FOR_CUSTOMER_COLLECTION')).toEqual([
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
    ]);
  });
});

describe('routeAnchorLabel', () => {
  it('puts arrived-in-Cyprus jobs in Limassol, not Piraeus', () => {
    expect(routeAnchorLabel('AT_GREECE')).toBe('Piraeus');
    expect(routeAnchorLabel('SHIPPING_TO_CYPRUS')).toBe('Piraeus');
    expect(routeAnchorLabel('ARRIVED_CYPRUS')).toBe('Limassol');
  });
});

describe('isDestinationReached', () => {
  it('is true only from Cyprus arrival onward', () => {
    expect(isDestinationReached('SHIPPING_TO_CYPRUS')).toBe(false);
    expect(isDestinationReached('ARRIVED_CYPRUS')).toBe(true);
    expect(isDestinationReached('IN_TRANSIT_TO_GREECE')).toBe(false);
  });
});

describe('remainingCorridorFrom', () => {
  it('returns the full planned route when there is no GPS yet', () => {
    const remaining = remainingCorridorFrom(null, 'COLLECTED');
    expect(remaining[0]).toEqual(expect.objectContaining({ label: 'London' }));
    expect(remaining.at(-1)).toEqual(expect.objectContaining({ label: 'Limassol' }));
    expect(remaining.length).toBeGreaterThan(5);
  });

  it('extends a Greece ping through the ferry to Limassol', () => {
    const remaining = remainingCorridorFrom(
      { latitude: 40.6401, longitude: 22.9444 },
      'IN_TRANSIT_TO_GREECE',
    );
    expect(remaining[0]?.label).toBe('Thessaloniki');
    expect(remaining.map((point) => point.label)).toEqual(
      expect.arrayContaining(['Piraeus', 'Limassol']),
    );
  });

  it('hides the planned remainder once the vehicle has arrived', () => {
    expect(
      remainingCorridorFrom(
        { latitude: 34.7071, longitude: 33.0226 },
        'ARRIVED_CYPRUS',
      ),
    ).toEqual([]);
  });

  it('uses the assigned template waypoints when provided', () => {
    const northern = remainingCorridorFrom(null, 'NEW', [
      { label: 'London', latitude: 51.5, longitude: -0.1 },
      { label: 'Berlin', latitude: 52.5, longitude: 13.4 },
      { label: 'Sofia', latitude: 42.7, longitude: 23.3 },
    ]);
    expect(northern.map((point) => point.label)).toEqual([
      'London',
      'Berlin',
      'Sofia',
    ]);
  });
});
