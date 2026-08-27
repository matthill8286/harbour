import {
  parseRouteWaypoints,
  remainingCorridorFrom,
  type GeoPoint,
  type JobStatus,
} from '@vip/shared';

export function plannedRouteForJob(input: {
  status: string;
  current?: { latitude: number; longitude: number } | null;
  waypoints?: unknown;
}): GeoPoint[] {
  const waypoints = parseRouteWaypoints(input.waypoints);
  return remainingCorridorFrom(
    input.current,
    input.status as JobStatus,
    waypoints,
  );
}
