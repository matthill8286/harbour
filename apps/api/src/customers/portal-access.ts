export const PORTAL_ACCESS_STATUSES = ['NONE', 'INVITED', 'ACTIVE'] as const;
export type PortalAccessStatus = (typeof PORTAL_ACCESS_STATUSES)[number];

export type PortalAccess = {
  status: PortalAccessStatus;
  userId: string | null;
  email: string | null;
  invitedAt: Date | null;
  expiresAt: Date | null;
};

export function describePortalAccess(input: {
  user: { id: string; email: string; hasPassword: boolean } | null;
  pendingInvite: { createdAt: Date; expiresAt: Date } | null;
}): PortalAccess {
  if (input.user?.hasPassword) {
    return {
      status: 'ACTIVE',
      userId: input.user.id,
      email: input.user.email,
      invitedAt: input.pendingInvite?.createdAt ?? null,
      expiresAt: input.pendingInvite?.expiresAt ?? null,
    };
  }
  if (input.user && input.pendingInvite) {
    return {
      status: 'INVITED',
      userId: input.user.id,
      email: input.user.email,
      invitedAt: input.pendingInvite.createdAt,
      expiresAt: input.pendingInvite.expiresAt,
    };
  }
  return {
    status: 'NONE',
    userId: input.user?.id ?? null,
    email: input.user?.email ?? null,
    invitedAt: null,
    expiresAt: null,
  };
}
