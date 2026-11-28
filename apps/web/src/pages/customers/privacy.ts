export type ErasurePreview = {
  alreadyErased: boolean;
  openJobs: { id: string; reference: string; status: string }[];
  remove: {
    contactDetails: number;
    internalCustomerNotes: number;
    notes: number;
    gpsPoints: number;
    documents: number;
    photos: number;
    portalAccess: number;
    portalInvites: number;
  };
  anonymise: { tasks: number; journeys: number; statusNotes: number; auditEntries: number };
  keep: { jobs: number; vehicles: number; files: number; costs: number; charges: number };
  review: { kind: ReviewKind; reason: string; jobReference: string | null }[];
  confirmation: string;
};

export type ReviewKind = 'DOCUMENT' | 'PHOTO' | 'COST' | 'CHARGE';

export type ErasureStatus = {
  erasedAt: string | null;
  reviewItems: {
    id: string;
    kind: ReviewKind;
    reason: string;
    importJobId: string | null;
    jobReference: string | null;
    decision: 'KEPT' | 'REMOVED' | null;
  }[];
  filesNotRemoved?: number;
};

export const KIND_LABEL: Record<ReviewKind, string> = {
  DOCUMENT: 'Document',
  PHOTO: 'Photo',
  COST: 'Cost',
  CHARGE: 'Customer charge',
};

const count = (n: number, one: string, many = `${one}s`) => (n ? `${n} ${n === 1 ? one : many}` : null);
const present = (items: (string | null)[]) => items.filter((item): item is string => item !== null);

/** The preview in words. Lines with nothing in them are left out. */
export function previewSections(preview: ErasurePreview) {
  const { remove, anonymise, keep } = preview;
  return [
    {
      heading: 'Removed for good',
      lines: present([
        'Their name and every contact detail on the customer record',
        remove.internalCustomerNotes ? 'The internal notes on the customer record' : null,
        count(remove.notes, 'note'),
        count(remove.gpsPoints, 'GPS position'),
        count(remove.documents, 'document of their own', 'documents of their own'),
        count(remove.photos, 'photo'),
        remove.portalAccess || remove.portalInvites ? 'Their portal access and invite links' : null,
      ]),
    },
    {
      heading: 'Kept, with personal text taken out',
      lines: present([
        count(anonymise.tasks, 'task'),
        count(anonymise.journeys, 'journey'),
        count(anonymise.statusNotes, 'status note'),
        count(anonymise.auditEntries, 'history entry', 'history entries'),
      ]),
    },
    {
      heading: 'Kept, because the law may require it',
      lines: present([
        count(keep.jobs, 'job record'),
        count(keep.vehicles, 'vehicle with its VIN and registrations', 'vehicles with their VINs and registrations'),
        count(keep.files, 'invoice, customs, import, registration or transport file', 'invoice, customs, import, registration or transport files'),
        count(keep.costs, 'cost'),
        count(keep.charges, 'customer charge'),
      ]),
    },
  ].filter((section) => section.lines.length > 0);
}
