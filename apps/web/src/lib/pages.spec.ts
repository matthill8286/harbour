import { describe, expect, it } from 'vitest';
import { withQuery } from './pages';

describe('withQuery', () => {
  it('leaves out parameters without a value', () => {
    expect(withQuery('/import-jobs', { search: '', status: undefined, cursor: null })).toBe('/import-jobs');
  });

  it('encodes the values it keeps', () => {
    expect(withQuery('/customers', { search: 'a & b', limit: 1 })).toBe('/customers?search=a+%26+b&limit=1');
  });
});
