import type { JobStatus, TaskPriority } from '@vip/shared';

/** A job as `/import-jobs/:id` returns it. */
export type JobDetail = {
  id: string;
  reference: string;
  status: JobStatus;
  originCountry: string;
  destinationCountry: string;
  registrationCountry: string | null;
  expectedDeliveryDate: string | null;
  totals: { totalCost: number; totalCharge: number; margin: number };
  customer: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null };
  vehicle: {
    make: string | null;
    model: string | null;
    variant: string | null;
    ukRegistration: string | null;
    vin: string | null;
  };
  statusHistory: { id: string; toStatus: string; note: string | null; createdAt: string; changedBy?: { name: string } | null }[];
  tasks: {
    id: string;
    title: string;
    status: string;
    priority: TaskPriority;
    dueDate: string | null;
    createdAt?: string;
  }[];
  costs: { id: string; category: string; description: string; amount: string }[];
  charges: { id: string; category: string; description: string; amount: string }[];
  notes: { id: string; body: string; visibility: string; createdAt: string; author: { name: string } }[];
  journeys: { id: string; type: string; origin: string; destination: string; status: string }[];
  photos: {
    id: string;
    filename: string;
    category: string;
    mimeType: string;
    customerVisible: boolean;
    createdAt: string;
  }[];
  documents: {
    id: string;
    name: string;
    type: string;
    mimeType: string;
    sizeBytes: number;
    customerVisible: boolean;
    createdAt: string;
  }[];
  locationEvents?: Array<{
    id?: string;
    latitude: string | number;
    longitude: string | number;
    accuracy?: string | number | null;
    speed?: string | number | null;
    heading?: string | number | null;
    recordedAt: string;
  }>;
};
