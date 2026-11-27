import { describe, expect, it } from 'vitest';
import { pageTitle } from './page-title';

describe('page titles', () => {
  it.each([
    ['/', 'Board — Harbour'],
    ['/jobs/new', 'New job — Harbour'],
    ['/jobs/abc', 'Job — Harbour'],
    ['/jobs/', 'Jobs — Harbour'],
    ['/security/setup', 'Set up two-factor sign-in — Harbour'],
    ['/reset-password/token', 'Reset your password — Harbour'],
    ['/nowhere', 'Page not found — Harbour'],
  ])('names %s', (path, title) => {
    expect(pageTitle(path)).toBe(title);
  });
});
