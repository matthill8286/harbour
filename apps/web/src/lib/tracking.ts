import type { JobStatus, LocationPoint, MapConfig } from '@vip/shared';

export const FALLBACK_MAP: MapConfig = {
  provider: 'osm',
  tileUrl: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  attribution: '© OpenStreetMap © CARTO',
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
  status: JobStatus;
  customer: { firstName: string; lastName: string };
  vehicle: { make: string | null; model: string | null; ukRegistration: string | null };
  current: LocationPoint | null;
  trail: LocationPoint[];
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

export type LiveTracking = {
  map: MapConfig;
  vehicles: TrackingVehicle[];
};

export function trackerKindLabel(provider: string) {
  return provider === 'flespi' ? 'Teltonika / Flespi' : 'Demo simulator';
}
