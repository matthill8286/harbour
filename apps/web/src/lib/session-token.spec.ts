import { describe, expect, it } from 'vitest';
import { movedWorkspace, sessionMembership } from './session-token';

const token = (payload: object) => `x.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.y`;

describe('session tokens', () => {
  it('reads the membership', () => {
    expect(sessionMembership(token({ sub: 'u', membershipId: 'm1' }))).toBe('m1');
    expect(sessionMembership('nonsense')).toBeNull();
    expect(sessionMembership(null)).toBeNull();
  });

  it('notices only a move to another workspace', () => {
    const one = token({ membershipId: 'm1' });
    expect(movedWorkspace(one, token({ membershipId: 'm2' }))).toBe(true);
    expect(movedWorkspace(one, token({ membershipId: 'm1', iat: 2 }))).toBe(false);
    expect(movedWorkspace(one, null)).toBe(false);
    expect(movedWorkspace(null, one)).toBe(false);
  });
});
