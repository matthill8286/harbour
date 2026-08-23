import type { JobStatus, LocationPoint, MapConfig } from '@vip/shared';

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
    status: string;
    batteryLevel: number | null;
  }>;
};

export type LiveTracking = {
  map: MapConfig;
  vehicles: TrackingVehicle[];
};
