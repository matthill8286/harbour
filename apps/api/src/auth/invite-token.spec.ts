import { createInviteToken, hashInviteToken, INVITE_TTL_MS, inviteExpiresAt } from './invite-token';

describe('invite tokens', () => {
  it('never stores the raw token', () => {
    const { token, tokenHash } = createInviteToken();
    expect(tokenHash).not.toBe(token);
    expect(tokenHash).toBe(hashInviteToken(token));
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('expires after seven days', () => {
    const from = new Date('2026-08-23T12:00:00.000Z');
    expect(inviteExpiresAt(from).getTime() - from.getTime()).toBe(INVITE_TTL_MS);
  });
});
