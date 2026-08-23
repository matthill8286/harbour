import { toPortalJob } from './portal.view';

const source = {
  id: 'job-1',
  reference: 'CY-2026-00421',
  status: 'IN_TRANSIT_TO_GREECE',
  originCountry: 'GB',
  destinationCountry: 'CY',
  expectedDeliveryDate: new Date('2026-09-12'),
  vehicle: {
    make: 'BMW',
    model: 'M5',
    variant: 'Competition',
    ukRegistration: 'AB12 CDE',
    colour: 'Black Sapphire',
    year: 2019,
    vin: 'WBSSECRET123',
  },
  journeys: [
    {
      id: 'j1',
      type: 'ROAD',
      origin: 'London',
      destination: 'Dover',
      status: 'COMPLETED',
      startedAt: null,
      completedAt: null,
    },
  ],
  notes: [{ id: 'n1', body: 'On the ferry', createdAt: new Date('2026-08-23') }],
  documents: [
    {
      id: 'd1',
      name: 'v5c.pdf',
      type: 'V5C',
      mimeType: 'application/pdf',
      sizeBytes: 1200,
      createdAt: new Date('2026-08-20'),
      storageKey: 'org/secret/v5c.pdf',
    },
  ],
  photos: [
    {
      id: 'p1',
      filename: 'mileage.jpg',
      category: 'MILEAGE',
      mimeType: 'image/jpeg',
      createdAt: new Date('2026-08-20'),
      storageKey: 'org/secret/mileage.jpg',
    },
  ],
  statusHistory: [
    { id: 'h1', toStatus: 'NEW', note: null, createdAt: new Date('2026-08-01') },
  ],
};

describe('toPortalJob', () => {
  const view = toPortalJob(source);

  it('omits storage keys and other internal paths', () => {
    expect(JSON.stringify(view)).not.toContain('storageKey');
    expect(JSON.stringify(view)).not.toContain('org/secret');
    expect(view.documents[0]).not.toHaveProperty('storageKey');
    expect(view.photos[0]).not.toHaveProperty('storageKey');
  });

  it('never exposes VIN, costs, charges, or tracker identifiers', () => {
    expect(view.vehicle).not.toHaveProperty('vin');
    expect(view).not.toHaveProperty('costs');
    expect(view).not.toHaveProperty('charges');
    expect(view).not.toHaveProperty('totals');
    expect(view).not.toHaveProperty('trackerAssignments');
    expect(JSON.stringify(view)).not.toContain('WBSSECRET123');
  });

  it('keeps the customer-facing journey fields', () => {
    expect(view.reference).toBe('CY-2026-00421');
    expect(view.vehicle.make).toBe('BMW');
    expect(view.vehicle.colour).toBe('Black Sapphire');
    expect(view.vehicle.year).toBe(2019);
    expect(view.documents[0]).toMatchObject({ name: 'v5c.pdf', type: 'V5C', sizeBytes: 1200 });
    expect(view.notes[0].body).toBe('On the ferry');
  });
});
