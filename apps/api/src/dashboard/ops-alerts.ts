import {
  isDestinationReached,
  parseRouteWaypoints,
  ROUTE_UK_BG_GR_CENTRAL,
  type GeoPoint,
  type JobStatus,
} from '@vip/shared';

/** Default Limassol when a job has no route template waypoints. */
export const DEFAULT_DESTINATION: GeoPoint =
  ROUTE_UK_BG_GR_CENTRAL[ROUTE_UK_BG_GR_CENTRAL.length - 1];

export const DEFAULT_STALE_TRACKER_MS = 2 * 60 * 60 * 1000;
export const DEFAULT_NEAR_DESTINATION_METERS = 5_000;

export type OpsAlertKind = 'STALE_TRACKER' | 'NEAR_DESTINATION';

export type OpsAlert = {
  kind: OpsAlertKind;
  importJobId: string;
  reference: string;
  title: string;
  detail: string;
  trackerSerial?: string;
};

export function parsePositiveNumber(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function routeDestination(waypoints: unknown): GeoPoint {
  const points = parseRouteWaypoints(waypoints);
  if (points.length === 0) return DEFAULT_DESTINATION;
  return points[points.length - 1];
}

/** Great-circle distance in metres (WGS84 sphere). */
export function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Assigned tracker with no ping within the threshold (null lastSeenAt counts as stale). */
export function isTrackerStale(input: {
  lastSeenAt: Date | string | null | undefined;
  now?: Date;
  thresholdMs: number;
}): boolean {
  const { thresholdMs } = input;
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) return false;
  if (input.lastSeenAt == null) return true;
  const seen = new Date(input.lastSeenAt).getTime();
  if (!Number.isFinite(seen)) return true;
  const now = (input.now ?? new Date()).getTime();
  return now - seen >= thresholdMs;
}

/** Last ping is within radius of destination while status is not yet ARRIVED_CYPRUS+. */
export function isNearDestination(input: {
  status: string;
  current: { latitude: number; longitude: number } | null | undefined;
  destination: { latitude: number; longitude: number };
  radiusMeters: number;
}): boolean {
  if (isDestinationReached(input.status as JobStatus)) return false;
  if (!input.current) return false;
  if (!Number.isFinite(input.radiusMeters) || input.radiusMeters <= 0) {
    return false;
  }
  const { latitude, longitude } = input.current;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return (
    haversineMeters(input.current, input.destination) <= input.radiusMeters
  );
}

export function buildStaleTrackerAlert(input: {
  importJobId: string;
  reference: string;
  trackerSerial: string;
  lastSeenAt: Date | string | null;
}): OpsAlert {
  return {
    kind: 'STALE_TRACKER',
    importJobId: input.importJobId,
    reference: input.reference,
    trackerSerial: input.trackerSerial,
    title: 'Tracker quiet',
    detail:
      input.lastSeenAt == null
        ? `${input.trackerSerial} has never reported on ${input.reference}`
        : `${input.trackerSerial} has not reported recently on ${input.reference}`,
  };
}

export function buildNearDestinationAlert(input: {
  importJobId: string;
  reference: string;
  destinationLabel: string;
  distanceMeters: number;
}): OpsAlert {
  const km = (input.distanceMeters / 1000).toFixed(1);
  return {
    kind: 'NEAR_DESTINATION',
    importJobId: input.importJobId,
    reference: input.reference,
    title: 'Near destination',
    detail: `${input.reference} is ~${km} km from ${input.destinationLabel} — status not yet arrived`,
  };
}
