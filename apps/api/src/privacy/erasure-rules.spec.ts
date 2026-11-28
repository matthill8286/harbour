import { DocumentType, PhotoCategory } from '@prisma/client';
import {
  DOCUMENT_RULES,
  mentions,
  PHOTO_RULES,
  scrubbedMetadata,
} from './erasure-rules';

describe('erasure rules', () => {
  it('decides every document type and photo category', () => {
    expect(Object.keys(DOCUMENT_RULES).sort()).toEqual(
      Object.values(DocumentType).sort(),
    );
    expect(Object.keys(PHOTO_RULES).sort()).toEqual(
      Object.values(PhotoCategory).sort(),
    );
  });

  it('never removes tax, customs or registration papers, or unclear ones', () => {
    for (const type of ['PURCHASE_INVOICE', 'CUSTOMS', 'IMPORT'] as const) {
      expect(DOCUMENT_RULES[type]).toBe('RETAIN');
    }
    expect(DOCUMENT_RULES.OTHER).toBe('REVIEW');
    expect(PHOTO_RULES.OTHER).toBe('REVIEW');
  });

  it('keeps only ids and flags in an audit entry', () => {
    expect(
      scrubbedMetadata({
        customerId: 'c1',
        importJobId: 'j1',
        email: 'a@b.test',
        name: 'Passport.pdf',
        fields: ['name'],
      }),
    ).toEqual({ customerId: 'c1', importJobId: 'j1' });
    expect(scrubbedMetadata(null)).toEqual({});
  });

  it('spots a customer named on a financial record', () => {
    const person = {
      firstName: 'Anna',
      lastName: 'Ng',
      email: 'anna@example.test',
      phone: '+357 99 123456',
    };
    expect(mentions(person, 'Delivery for ANNA NG')).toBe(true);
    expect(mentions(person, 'Receipt to anna@example.test')).toBe(true);
    expect(mentions(person, 'Call 357-99-12-34-56 first')).toBe(true);
    // A two-letter surname on its own is in too many words to count.
    expect(mentions(person, 'Parking')).toBe(false);
    expect(mentions(person, null)).toBe(false);
  });
});
