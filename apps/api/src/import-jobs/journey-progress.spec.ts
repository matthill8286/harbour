import {
  isDestinationReached,
  journeyStatusesForJob,
  remainingCorridorFrom,
  routeAnchorLabel,
  type JobStatus,
} from '@vip/shared';

describe('journeyStatusesForJob', () => {
  it('keeps every leg planned before collection', () => {
    expect(journeyStatusesForJob('NEW')).toEqual(['PLANNED', 'PLANNED', 'PLANNED']);
    expect(journeyStatusesForJob('CONFIRMED')).toEqual(['PLANNED', 'PLANNED', 'PLANNED']);
  });

  it('does not mark the Cyprus crossing complete while still in Greece', () => {
    expect(journeyStatusesForJob('IN_TRANSIT_TO_GREECE')).toEqual(['COMPLETED', 'IN_PROGRESS', 'PLANNED']);
    expect(journeyStatusesForJob('AT_GREECE')).toEqual(['COMPLETED', 'COMPLETED', 'PLANNED']);
    expect(journeyStatusesForJob('SHIPPING_TO_CYPRUS')).toEqual(['COMPLETED', 'COMPLETED', 'IN_PROGRESS']);
  });

  it('completes every leg only after arrival in Cyprus', () => {
    expect(journeyStatusesForJob('ARRIVED_CYPRUS')).toEqual(['COMPLETED', 'COMPLETED', 'COMPLETED']);
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
    expect(isDestinationReached('IN_TRANSIT_TO_GREECE' as JobStatus)).toBe(false);
  });
});

describe('remainingCorridorFrom', () => {
  it('places jobs with no GPS on the status waypoint and keeps Cyprus ahead', () => {
    const remaining = remainingCorridorFrom(null, 'NEW');
    expect(remaining[0]?.label).toBe('London');
    expect(remaining.at(-1)?.label).toBe('Limassol');
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
    expect(remainingCorridorFrom({ latitude: 34.7071, longitude: 33.0226 }, 'ARRIVED_CYPRUS')).toEqual([]);
  });
});
