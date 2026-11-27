import { jobReferencePrefix } from './job-reference';

describe('jobReferencePrefix', () => {
  it('uses the destination country of the job', () => {
    expect(jobReferencePrefix('BG', 'CY')).toBe('BG');
    expect(jobReferencePrefix('CY', 'GB')).toBe('CY');
  });

  it('reads a code typed in lower case or with spaces', () => {
    expect(jobReferencePrefix(' mt ', 'CY')).toBe('MT');
  });

  it.each(['', '   ', 'C', 'CYP', 'Cyprus', 'C1', '??', '.*', 'ΚΥ'])(
    'uses the workspace country when the destination is %j',
    (destination) => {
      expect(jobReferencePrefix(destination, 'mt')).toBe('MT');
    },
  );

  it('falls back to CY when neither is a two-letter code', () => {
    expect(jobReferencePrefix('', 'Malta')).toBe('CY');
  });
});
