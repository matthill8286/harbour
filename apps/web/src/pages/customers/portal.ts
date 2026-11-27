/** Where a customer is with the portal. */
export type PortalStatus = 'NONE' | 'INVITED' | 'ACTIVE';

export const PORTAL_LABEL: Record<PortalStatus, string> = {
  NONE: 'No portal',
  INVITED: 'Invite pending',
  ACTIVE: 'Portal active',
};

/** The badge tone for each portal state: filled when active, quiet otherwise. */
export const PORTAL_TONE: Record<PortalStatus, 'solid' | 'neutral'> = {
  NONE: 'neutral',
  INVITED: 'neutral',
  ACTIVE: 'solid',
};
