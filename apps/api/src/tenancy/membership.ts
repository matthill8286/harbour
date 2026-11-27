export type MembershipCandidate = {
  id: string;
  role: string;
  status: string;
  createdAt: Date;
  organisation: { status: string };
};

export function pickActiveMembership<T extends MembershipCandidate>(
  memberships: T[],
): T | null {
  const active = memberships.filter(
    (item) => item.status === 'ACTIVE' && item.organisation.status === 'ACTIVE',
  );
  if (active.length === 0) {
    return null;
  }
  const staff = active.filter((item) => item.role !== 'CUSTOMER');
  const pool = staff.length > 0 ? staff : active;
  return (
    [...pool].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0] ?? null
  );
}
