import { organisationSlug } from '../auth/signup/signup';
import { DEMO_WORKSPACE_SLUGS, sampleDataAllowed } from './sample-data';

describe('sampleDataAllowed', () => {
  it('allows every workspace outside production', () => {
    expect(sampleDataAllowed(undefined, 'acme-1a2b3c')).toBe(true);
    expect(sampleDataAllowed('development', 'acme-1a2b3c')).toBe(true);
  });

  it('allows only the demo workspaces in production', () => {
    expect(sampleDataAllowed('production', 'demo-imports')).toBe(true);
    expect(sampleDataAllowed('production', 'cyprus-auto-logistics')).toBe(true);
    expect(sampleDataAllowed('production', 'acme-1a2b3c')).toBe(false);
    expect(sampleDataAllowed('production', undefined)).toBe(false);
  });

  it('cannot be claimed by signing up with a demo name', () => {
    const slug = organisationSlug('Demo Imports');
    expect(DEMO_WORKSPACE_SLUGS.has(slug)).toBe(false);
  });
});
