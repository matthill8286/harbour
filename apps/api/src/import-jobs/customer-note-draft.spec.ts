import {
  buildCustomerNoteDraft,
  vehicleSummaryFromParts,
} from './customer-note-draft';

describe('buildCustomerNoteDraft', () => {
  const base = {
    reference: 'IMP-1001',
    statusLabel: 'In transit to Greece',
    vehicleSummary: 'BMW 320d (KN19 XPL)',
    intent: 'Ferry delayed by weather; new ETA tomorrow afternoon',
  };

  it('builds a professional template from intent and status', () => {
    const draft = buildCustomerNoteDraft(base);
    expect(draft).toContain('IMP-1001');
    expect(draft).toContain('In transit to Greece');
    expect(draft).toContain('BMW 320d (KN19 XPL)');
    expect(draft).toContain('Ferry delayed by weather');
    expect(draft).not.toMatch(/margin|IMEI|cost/i);
  });

  it('supports brief tone without a long greeting', () => {
    const draft = buildCustomerNoteDraft({ ...base, tone: 'brief' });
    expect(draft.startsWith('Quick update')).toBe(true);
    expect(draft).not.toContain('Hello,');
  });

  it('handles empty intent with a soft placeholder line', () => {
    const draft = buildCustomerNoteDraft({ ...base, intent: '  ' });
    expect(draft).toContain('further update shortly');
  });
});

describe('vehicleSummaryFromParts', () => {
  it('joins make/model/reg without inventing fields', () => {
    expect(
      vehicleSummaryFromParts({
        make: 'Audi',
        model: 'A4',
        variant: null,
        ukRegistration: 'LF21 TRK',
      }),
    ).toBe('Audi A4 (LF21 TRK)');
    expect(vehicleSummaryFromParts({})).toBe('');
  });
});
