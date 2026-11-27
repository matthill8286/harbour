import { describe, expect, it } from 'vitest';
import { previewSections, type ErasurePreview } from './privacy';

const nothing: ErasurePreview = {
  alreadyErased: false,
  openJobs: [],
  remove: {
    contactDetails: 0,
    internalCustomerNotes: 0,
    notes: 0,
    gpsPoints: 0,
    documents: 0,
    photos: 0,
    portalAccess: 0,
    portalInvites: 0,
  },
  anonymise: { tasks: 0, journeys: 0, statusNotes: 0, auditEntries: 0 },
  keep: { jobs: 0, vehicles: 0, files: 0, costs: 0, charges: 0 },
  review: [],
  confirmation: '',
};

describe('erasure preview', () => {
  it('always says the record itself is emptied, and leaves out empty lines', () => {
    expect(previewSections(nothing)).toEqual([{ heading: 'Removed for good', lines: ['Their name and every contact detail on the customer record'] }]);
  });

  it('counts in the singular and plural', () => {
    const sections = previewSections({
      ...nothing,
      remove: { ...nothing.remove, notes: 1, photos: 3 },
      keep: { ...nothing.keep, vehicles: 2 },
    });
    expect(sections[0].lines).toContain('1 note');
    expect(sections[0].lines).toContain('3 photos');
    expect(sections[1].lines).toEqual(['2 vehicles with their VINs and registrations']);
  });
});
