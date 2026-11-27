/**
 * What erasing a customer does with each kind of record. These are cautious
 * defaults, not legal advice: a lawyer or accountant has to confirm what the
 * law requires to be kept, and for how long. Nothing here expires by itself.
 *
 * - REMOVE: personal data with no reason to be kept.
 * - RETAIN: a record the law may require. It is kept, with its personal labels
 *   taken off.
 * - REVIEW: it is not clear which, so it is kept and flagged for an Admin.
 */
import type { DocumentType, PhotoCategory } from '@prisma/client';

export type Disposition = 'REMOVE' | 'RETAIN' | 'REVIEW';

export const DOCUMENT_RULES: Record<DocumentType, Disposition> = {
  PURCHASE_INVOICE: 'RETAIN',
  CUSTOMS: 'RETAIN',
  IMPORT: 'RETAIN',
  REGISTRATION: 'RETAIN',
  TRANSPORT: 'RETAIN',
  /** A vehicle's registration certificate names its keepers. */
  V5C: 'REVIEW',
  INSPECTION: 'REVIEW',
  OTHER: 'REVIEW',
  /** The customer's own papers. */
  CUSTOMER: 'REMOVE',
};

export const PHOTO_RULES: Record<PhotoCategory, Disposition> = {
  BEFORE_COLLECTION: 'REMOVE',
  COLLECTION: 'REMOVE',
  ARRIVAL: 'REMOVE',
  FINAL: 'REMOVE',
  /** These can be evidence: of condition, mileage or identity for registration. */
  DAMAGE: 'REVIEW',
  MILEAGE: 'REVIEW',
  VIN: 'REVIEW',
  REGISTRATION: 'REVIEW',
  OTHER: 'REVIEW',
};

/** What an erased customer record holds in place of a name. */
export const ERASED_NAME = { firstName: 'Erased', lastName: 'customer' };
export const REMOVED_TEXT = 'Removed';

/** The only audit details that survive. Each is an id or a yes or no. */
const AUDIT_KEYS = new Set([
  'customerId',
  'importJobId',
  'trackerId',
  'customerVisible',
]);

export function scrubbedMetadata(
  metadata: unknown,
): Record<string, string | boolean> {
  if (!metadata || typeof metadata !== 'object') return {};
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => AUDIT_KEYS.has(key)),
  );
}

type Person = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
};

/** Shorter than this, a surname or number would match half the words there are. */
const MIN_TERM = 3;
const MIN_PHONE_DIGITS = 6;

/** Whether free text on a financial record appears to name the customer. */
export function mentions(person: Person, text: string | null): boolean {
  if (!text) return false;
  const haystack = text.toLocaleLowerCase();
  const terms = [
    `${person.firstName} ${person.lastName}`,
    person.lastName,
    person.email ?? '',
  ]
    .map((term) => term.trim().toLocaleLowerCase())
    .filter((term) => term.length >= MIN_TERM);
  if (terms.some((term) => haystack.includes(term))) return true;
  const digits = (value: string) => value.replace(/\D/g, '');
  const phone = digits(person.phone ?? '');
  return phone.length >= MIN_PHONE_DIGITS && digits(text).includes(phone);
}
