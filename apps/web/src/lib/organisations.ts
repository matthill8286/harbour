import { useQuery } from '@tanstack/react-query';
import type { UserRole } from '@vip/shared';
import { api } from './api';
import { useAuth } from './auth';

export type MyOrganisation = {
  membershipId: string;
  name: string;
  role: UserRole;
  current: boolean;
};

/** The workspaces this person can use. The switcher shows only when there is more than one. */
export function useOrganisations() {
  const membershipId = useAuth((state) => state.user?.membershipId);
  return useQuery({
    queryKey: ['my-organisations', membershipId],
    queryFn: () => api<MyOrganisation[]>('/auth/organisations'),
    enabled: Boolean(membershipId),
  });
}
