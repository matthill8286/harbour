import { isSafeObjectKey, monthStartUtc, tenantObjectKey } from './tenant-keys';

describe('tenant object keys', () => {
  it('nests files under the organisation and job', () => {
    expect(
      tenantObjectKey({
        organisationId: 'org-a',
        importJobId: 'job-1',
        kind: 'documents',
        originalName: 'v5c.pdf',
        id: 'file-1',
      }),
    ).toBe('org-a/jobs/job-1/documents/file-1.pdf');
  });

  it('rejects path traversal and cross-tenant keys', () => {
    expect(isSafeObjectKey('../etc/passwd', 'org-a')).toBe(false);
    expect(isSafeObjectKey('/org-a/jobs/x/photos/a.png', 'org-a')).toBe(false);
    expect(isSafeObjectKey('org-b/jobs/x/photos/a.png', 'org-a')).toBe(false);
    expect(isSafeObjectKey('org-a/jobs/x/photos/a.png', 'org-a')).toBe(true);
  });
});

describe('monthStartUtc', () => {
  it('snaps usage to the first of the UTC month', () => {
    expect(monthStartUtc(new Date('2026-03-27T18:00:00.000Z')).toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    );
  });
});
