import type { LocationPoint, MapConfig } from '@vip/shared';

export const FALLBACK_MAP: MapConfig = {
  provider: 'osm',
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19,
};

export function toLocationPoint(raw: {
  id?: string;
  latitude: string | number;
  longitude: string | number;
  accuracy?: string | number | null;
  speed?: string | number | null;
  heading?: string | number | null;
  recordedAt: string;
}): LocationPoint {
  return {
    id: raw.id,
    latitude: Number(raw.latitude),
    longitude: Number(raw.longitude),
    accuracy: raw.accuracy == null || raw.accuracy === '' ? null : Number(raw.accuracy),
    speed: raw.speed == null || raw.speed === '' ? null : Number(raw.speed),
    heading: raw.heading == null || raw.heading === '' ? null : Number(raw.heading),
    recordedAt: raw.recordedAt,
  };
}

export type TrackingVehicle = {
  importJobId: string;
  reference: string;
  /** A status of the job's route, or COMPLETED or CANCELLED. */
  status: string;
  routeId?: string | null;
  customer: { firstName: string; lastName: string };
  vehicle: { make: string | null; model: string | null; ukRegistration: string | null };
  current: LocationPoint | null;
  trail: LocationPoint[];
  plannedRoute: Array<{ label: string; latitude: number; longitude: number }>;
  routeTemplate: {
    id: string;
    code: string;
    name: string;
    description: string | null;
  } | null;
  tracker: {
    assignmentId: string;
    assignedAt: string;
    id: string;
    serialNumber: string;
    provider: string;
    batteryLevel: number | null;
    lastSeenAt: string | null;
    status: string;
  } | null;
};

export type RouteTemplateOption = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  waypoints: Array<{ label: string; latitude: number; longitude: number }>;
  sortOrder: number;
};

export type JobTracking = TrackingVehicle & {
  map: MapConfig;
  availableTrackers?: Array<{
    id: string;
    serialNumber: string;
    provider: string;
    status: string;
    batteryLevel: number | null;
  }>;
};

type Corridor = TrackingVehicle['plannedRoute'];

/** A vehicle in the live list: where it is now, without its trail. */
export type LiveVehicle = Omit<TrackingVehicle, 'trail' | 'plannedRoute' | 'routeTemplate'> & {
  /** What is left of its corridor: one of the list's corridors, from this waypoint on. */
  corridor: { id: string; from: number } | null;
};

export type LiveTracking = {
  map: MapConfig;
  /** Each corridor once, however many vehicles are on it. */
  corridors: Record<string, Corridor>;
  vehicles: LiveVehicle[];
};

export type LiveTrail = { trail: LocationPoint[] };

/** The waypoints still ahead of a vehicle. */
export function plannedRouteOf(vehicle: Pick<LiveVehicle, 'corridor'>, corridors: LiveTracking['corridors']): Corridor {
  const { corridor } = vehicle;
  return corridor ? (corridors[corridor.id] ?? []).slice(corridor.from) : [];
}

export function trackerKindLabel(provider: string) {
  return provider === 'flespi' ? 'Teltonika / Flespi' : 'Demo simulator';
}

/** Nudge stacked fleet pings so two London jobs are both clickable. */
export function spreadOverlappingMarkers<T extends { latitude: number; longitude: number }>(markers: T[], radiusDeg = 0.55): T[] {
  const groups = new Map<string, number[]>();
  markers.forEach((marker, index) => {
    const key = `${marker.latitude.toFixed(2)}:${marker.longitude.toFixed(2)}`;
    const members = groups.get(key) ?? [];
    members.push(index);
    groups.set(key, members);
  });
  return markers.map((marker, index) => {
    const members = groups.get(`${marker.latitude.toFixed(2)}:${marker.longitude.toFixed(2)}`) ?? [index];
    if (members.length < 2) return marker;
    const offset = members.indexOf(index);
    return {
      ...marker,
      latitude: marker.latitude - offset * (radiusDeg * 0.45),
      longitude: marker.longitude + offset * radiusDeg,
    };
  });
}
