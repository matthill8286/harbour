/** The membership a session token belongs to, or null if it cannot be read. */
export function sessionMembership(token: string | null): string | null {
  try {
    const part = (token ?? '').split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(part ?? '')) as { membershipId?: unknown };
    return typeof payload.membershipId === 'string' ? payload.membershipId : null;
  } catch {
    return null;
  }
}

/**
 * Another tab replaced this session with one for a different workspace. This
 * tab still shows the old one, but its next request would use the new session.
 */
export function movedWorkspace(before: string | null, after: string | null): boolean {
  const was = sessionMembership(before);
  const now = sessionMembership(after);
  return was !== null && now !== null && was !== now;
}
