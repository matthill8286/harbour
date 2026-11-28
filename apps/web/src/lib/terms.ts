import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type LegalDocument, type LegalDocumentKey, type SubProcessor } from '@vip/shared';
import { api } from './api';
import { useAuth } from './auth';

export type TermsStatus = {
  outstanding: LegalDocumentKey[];
  documents: Array<
    LegalDocument & {
      accepted: {
        version: string;
        current: boolean;
        acceptedAt: string;
        /** Shown to Admins only. */
        acceptedBy: string | null;
      } | null;
    }
  >;
  subProcessorsVersion: string;
  subProcessors: SubProcessor[];
};

/** What this workspace has accepted. Staff only; the portal never asks. */
export function useTerms(enabled = true) {
  const membershipId = useAuth((state) => state.user?.membershipId);
  return useQuery({
    queryKey: ['terms', membershipId],
    queryFn: () => api<TermsStatus>('/organisation/terms'),
    enabled: enabled && Boolean(membershipId),
    staleTime: 5 * 60_000,
  });
}

/** The versions shown, which are the ones a person accepts. */
export const shownVersions = (status: TermsStatus) => Object.fromEntries(status.documents.map((document) => [document.key, document.version]));

/** An Admin accepts, for the workspace, the versions they were shown. */
export function useAcceptTerms() {
  const queryClient = useQueryClient();
  const membershipId = useAuth((state) => state.user?.membershipId);
  return useMutation({
    mutationFn: (status: TermsStatus) =>
      api<TermsStatus>('/organisation/terms/accept', {
        method: 'POST',
        body: JSON.stringify({ versions: shownVersions(status) }),
      }),
    onSuccess: (status) => queryClient.setQueryData(['terms', membershipId], status),
  });
}
