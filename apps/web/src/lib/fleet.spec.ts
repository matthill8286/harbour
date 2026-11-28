import { describe, expect, it } from 'vitest';
import { distanceKm, hasSignal, nearWaypoint } from './fleet';

const now = Date.parse('2026-11-27T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const ping = {
  latitude: 42.7,
  longitude: 23.3,
  accuracy: null,
  speed: 80,
  heading: null,
  recordedAt: new Date(now - 60_000).toISOString(),
};
const tracker = (status: string, msAgo: number, reportIntervalMinutes = 60) => ({
  assignmentId: 'a',
  assignedAt: '',
  id: 't',
  serialNumber: '1',
  provider: 'flespi',
  batteryLevel: 80,
  lastSeenAt: new Date(now - msAgo).toISOString(),
  status,
  powerSource: 'BATTERY' as const,
  reportIntervalMinutes,
  supplyVoltage: null,
  fittedBy: null,
  ownerPermissionHeld: false,
  signal: { state: 'LIVE' as const, lastSeenAt: null, noSignalAfterMinutes: 120 },
});

describe('hasSignal', () => {
  it('is live while the unit has missed fewer than two reports', () => {
    expect(hasSignal({ current: ping, tracker: tracker('ASSIGNED', HOUR) }, now)).toBe(true);
    expect(hasSignal({ current: ping, tracker: tracker('ASSIGNED', 10 * HOUR, 6 * 60) }, now)).toBe(true);
  });
  it('is silent with no ping, no tracker, two missed reports or an offline tracker', () => {
    expect(hasSignal({ current: null, tracker: tracker('ASSIGNED', HOUR) }, now)).toBe(false);
    expect(hasSignal({ current: ping, tracker: null }, now)).toBe(false);
    expect(hasSignal({ current: ping, tracker: tracker('ASSIGNED', 2 * HOUR) }, now)).toBe(false);
    expect(hasSignal({ current: ping, tracker: tracker('OFFLINE', 60_000) }, now)).toBe(false);
  });
});

describe('nearWaypoint', () => {
  const route = [
    { label: 'London', latitude: 51.5, longitude: -0.12 },
    { label: 'Sofia', latitude: 42.69, longitude: 23.32 },
  ];
  it('names the closest stop within range', () => {
    expect(nearWaypoint({ latitude: 42.5, longitude: 23.1 }, route)).toBe('Sofia');
  });
  it('names nothing when every stop is far away', () => {
    expect(nearWaypoint({ latitude: 35.1, longitude: 33.4 }, route)).toBeNull();
  });
  it('measures London to Sofia at about 2,000 km', () => {
    expect(Math.round(distanceKm(route[0], route[1]) / 100)).toBe(20);
  });
});
