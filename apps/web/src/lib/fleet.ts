import type { TrackingVehicle } from './tracking';

/** A tracker that has not pinged for this long counts as having no signal. */
export const SILENT_AFTER_MS = 6 * 60 * 60 * 1000;

/** Whether a vehicle's tracker is reporting: live, or silent (never pinged, offline or quiet too long). */
export function hasSignal(vehicle: Pick<TrackingVehicle, 'current' | 'tracker'>, now = Date.now()) {
  if (!vehicle.current) return false;
  if (vehicle.tracker?.status === 'OFFLINE') return false;
  return now - new Date(vehicle.current.recordedAt).getTime() < SILENT_AFTER_MS;
}

type Point = { latitude: number; longitude: number };

/** Distance between two points in kilometres, on a sphere. */
export function distanceKm(a: Point, b: Point) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * The planned waypoint a vehicle is near, so the fleet list can say "Near Sofia"
 * without a geocoder. Nothing when the closest one is further than `withinKm`.
 */
export function nearWaypoint(point: Point, route: Array<Point & { label: string }>, withinKm = 150) {
  let best: { label: string; km: number } | null = null;
  for (const stop of route) {
    const km = distanceKm(point, stop);
    if (!best || km < best.km) best = { label: stop.label, km };
  }
  return best && best.km <= withinKm ? best.label : null;
}
