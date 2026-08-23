type PortalJobSource = {
  id: string;
  reference: string;
  status: string;
  originCountry: string;
  destinationCountry: string;
  expectedDeliveryDate: Date | null;
  vehicle: {
    make: string | null;
    model: string | null;
    variant: string | null;
    ukRegistration: string | null;
    colour: string | null;
    year: number | null;
    vin?: string | null;
  };
  journeys: Array<{
    id: string;
    type: string;
    origin: string;
    destination: string;
    status: string;
    startedAt: Date | null;
    completedAt: Date | null;
  }>;
  notes: Array<{ id: string; body: string; createdAt: Date }>;
  documents: Array<{
    id: string;
    name: string;
    type: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
    storageKey?: string;
  }>;
  photos: Array<{
    id: string;
    filename: string;
    category: string;
    mimeType: string;
    createdAt: Date;
    storageKey?: string;
  }>;
  statusHistory: Array<{
    id: string;
    toStatus: string;
    note: string | null;
    createdAt: Date;
  }>;
};

export function toPortalJob(job: PortalJobSource) {
  return {
    id: job.id,
    reference: job.reference,
    status: job.status,
    originCountry: job.originCountry,
    destinationCountry: job.destinationCountry,
    expectedDeliveryDate: job.expectedDeliveryDate,
    vehicle: {
      make: job.vehicle.make,
      model: job.vehicle.model,
      variant: job.vehicle.variant,
      ukRegistration: job.vehicle.ukRegistration,
      colour: job.vehicle.colour,
      year: job.vehicle.year,
    },
    journeys: job.journeys.map((journey) => ({
      id: journey.id,
      type: journey.type,
      origin: journey.origin,
      destination: journey.destination,
      status: journey.status,
      startedAt: journey.startedAt,
      completedAt: journey.completedAt,
    })),
    notes: job.notes.map((note) => ({
      id: note.id,
      body: note.body,
      createdAt: note.createdAt,
    })),
    documents: job.documents.map((document) => ({
      id: document.id,
      name: document.name,
      type: document.type,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      createdAt: document.createdAt,
    })),
    photos: job.photos.map((photo) => ({
      id: photo.id,
      filename: photo.filename,
      category: photo.category,
      mimeType: photo.mimeType,
      createdAt: photo.createdAt,
    })),
    statusHistory: job.statusHistory.map((item) => ({
      id: item.id,
      toStatus: item.toStatus,
      note: item.note,
      createdAt: item.createdAt,
    })),
  };
}
