import { getStatusLabel, type JobStatus } from '@vip/shared';
import { formatCategory, money } from '../../lib/format';

/** One entry in a job's Activity, as `/import-jobs/:id/activity` returns it. */
export type ActivityItem = {
  id: string;
  action: string;
  createdAt: string;
  actor: { name: string } | null;
  metadata: {
    reference?: string;
    from?: string;
    to?: string;
    customerVisible?: boolean;
    name?: string;
    filename?: string;
    serialNumber?: string;
    visibility?: string;
    kind?: string;
    category?: string;
    description?: string;
    amount?: number;
    before?: { category?: string; description?: string; amount?: number };
  } | null;
};

const shared = (visible?: boolean) => (visible ? 'visible to customer' : 'internal');

/**
 * What happened, as the middle and end of a sentence that starts with who did
 * it: "changed status", "Registered → In transit to Greece". The Figma Activity
 * frame reads each entry that way. Amounts may show, because Activity is only
 * ever seen by staff.
 */
export function describeActivity(item: ActivityItem, currency: string): { verb: string; detail: string } {
  const m = item.metadata ?? {};
  const line = () => [m.description || formatCategory(m.category ?? ''), typeof m.amount === 'number' ? money(m.amount, currency) : null].filter(Boolean).join(' · ');
  const word = m.kind === 'charge' ? 'charge' : 'cost';
  switch (item.action) {
    case 'JOB_CREATED':
      return { verb: 'created the job', detail: m.reference ?? '' };
    case 'JOB_STATUS_CHANGED':
      return { verb: 'changed status', detail: m.from && m.to ? `${getStatusLabel(m.from as JobStatus)} → ${getStatusLabel(m.to as JobStatus)}` : '' };
    case 'JOB_ROUTE_TEMPLATE_CHANGED':
      return { verb: 'changed the corridor', detail: '' };
    case 'JOB_NOTE_ADDED':
      return { verb: 'added a note', detail: m.visibility === 'CUSTOMER' ? 'Visible to customer' : 'Internal' };
    case 'DOCUMENT_UPLOADED':
      return { verb: 'uploaded a document', detail: [m.name, shared(m.customerVisible)].filter(Boolean).join(' · ') };
    case 'PHOTO_UPLOADED':
      return { verb: 'uploaded a photo', detail: [m.filename, shared(m.customerVisible)].filter(Boolean).join(' · ') };
    case 'FILE_VISIBILITY_CHANGED':
      return { verb: m.customerVisible ? 'shared a file with the customer' : 'made a file internal', detail: m.name ?? '' };
    case 'TRACKER_ASSIGNED':
      return { verb: 'assigned a tracker', detail: m.serialNumber ?? '' };
    case 'TRACKER_UNASSIGNED':
      return { verb: 'removed the tracker', detail: '' };
    case 'MONEY_LINE_ADDED':
      return { verb: `added a ${word}`, detail: line() };
    case 'MONEY_LINE_DELETED':
      return { verb: `deleted a ${word}`, detail: line() };
    case 'MONEY_LINE_UPDATED': {
      const was = m.before && typeof m.before.amount === 'number' && m.before.amount !== m.amount ? ` (was ${money(m.before.amount, currency)})` : '';
      return { verb: `edited a ${word}`, detail: `${line()}${was}` };
    }
    default:
      return { verb: formatCategory(item.action).toLowerCase(), detail: '' };
  }
}
