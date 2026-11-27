import type { CustomerStep } from '@vip/shared';
import { countryName } from '../job/countries';

type Vehicle = { make: string | null; model: string | null; variant: string | null; ukRegistration: string | null; colour: string | null; year: number | null };

/** A vehicle in the customer's list, as `/portal/jobs` returns it. */
export type PortalVehicle = {
  id: string;
  reference: string;
  status: string;
  statusLabel: string;
  journey: CustomerStep[];
  routeLabel: string;
  /** False while the job is still at its route's first status. */
  started: boolean;
  /** True at the route's last status, before the job is completed. */
  readyToCollect: boolean;
  expectedDeliveryDate: string | null;
  completedAt: string | null;
  destinationCountry: string;
  vehicle: Vehicle;
  coverPhotoId: string | null;
  photoCount: number;
  documentCount: number;
};

export type PortalPhoto = { id: string; filename: string; category: string; mimeType: string; createdAt: string };
export type PortalDocument = { id: string; name: string; type: string; mimeType: string; sizeBytes: number; createdAt: string };
export type PortalLeg = { id: string; type: string; origin: string; destination: string; status: string; startedAt: string | null; completedAt: string | null };

/** One vehicle in full, as `/portal/jobs/:id` returns it. */
export type PortalJob = Omit<PortalVehicle, 'coverPhotoId' | 'photoCount' | 'documentCount' | 'completedAt'> & {
  originCountry: string;
  journeys: PortalLeg[];
  notes: { id: string; body: string; createdAt: string }[];
  documents: PortalDocument[];
  photos: PortalPhoto[];
  statusHistory: { id: string; toStatus: string; label: string; note: string | null; createdAt: string }[];
};

export const vehicleName = (v: Pick<Vehicle, 'make' | 'model'>) => [v.make, v.model].filter(Boolean).join(' ') || 'Your vehicle';

export const isOpen = (status: string) => status !== 'COMPLETED' && status !== 'CANCELLED';

/** Whether the vehicle has reached the last step the customer sees, or is complete. */
export const hasArrived = (job: Pick<PortalVehicle, 'status' | 'journey'>) =>
  job.status === 'COMPLETED' || (job.journey.length > 0 && job.journey[job.journey.length - 1].state !== 'next');

/**
 * The big line on the vehicle page, in the customer's words: "Your import is
 * open", "On its way to Greece", "Ready for you to collect" or "Delivered".
 */
export function headline(job: Pick<PortalVehicle, 'status' | 'journey' | 'started' | 'readyToCollect'>) {
  if (job.status === 'COMPLETED') return 'Delivered';
  if (job.status === 'CANCELLED') return 'This import was cancelled';
  if (!job.started) return 'Your import is open';
  if (job.readyToCollect) return 'Ready for you to collect';
  const at = job.journey.findIndex((step) => step.state === 'current');
  const step = job.journey[at];
  if (!step) return 'Your import is under way';
  if (at === 0) return `In ${step.name}`;
  return step.detail === 'On the way' || at < job.journey.length - 1 ? `On its way to ${step.name}` : `Arrived in ${step.name}`;
}

/** "Leg 2 of 3 · Bulgaria → Greece by road", from the legs the importer planned. */
export function legLine(legs: PortalLeg[]) {
  const at = legs.findIndex((leg) => leg.status === 'IN_PROGRESS');
  if (at === -1) return null;
  const leg = legs[at];
  const by = leg.type === 'FERRY' ? ' by sea' : leg.type === 'ROAD' ? ' by road' : '';
  return `Leg ${at + 1} of ${legs.length} · ${place(leg.origin)} → ${place(leg.destination)}${by}`;
}

/** A leg's end is a country code or a place name. */
export const place = (value: string) => (/^[A-Z]{2}$/.test(value) ? countryName(value) : value);
