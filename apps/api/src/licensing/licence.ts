/**
 * A workspace's licence, as the Impakt account service reports it. Harbour keeps
 * its own accounts and sign-in. The licence says only whether a workspace may
 * use Harbour, and how much.
 */
export type LicenceStatus =
  'pending' | 'active' | 'grace' | 'read_only' | 'expired' | 'suspended';

export type Licence = {
  id: string;
  plan: string;
  status: LicenceStatus;
  /** How many team members the workspace may have, or null for no limit. */
  seats: number | null;
  /** Ceilings Harbour enforces, such as `importJobsPerMonth`. */
  limits: Record<string, number>;
  endsAt: string | null;
  graceEndsAt: string | null;
  readOnlyEndsAt: string | null;
  /** The workspace the licence covers, or null until it is set up. */
  tenant: string | null;
  /** The addresses allowed to set the workspace up. */
  owners: string[];
};

/** `full`: everything works. `read`: nothing can be changed. `none`: the workspace cannot be used. */
export type Access = 'full' | 'read' | 'none';

/**
 * What a workspace may do under its licence. A licence that has run out leaves
 * the workspace readable for good, because Harbour never blocks reading and
 * exporting over a lapsed plan. Only a licence that has not started, one an
 * operator suspended, or no licence at all shuts the workspace.
 */
export function accessFor(licence: Licence | null): Access {
  if (!licence) return 'none';
  if (licence.status === 'active' || licence.status === 'grace') return 'full';
  if (licence.status === 'read_only' || licence.status === 'expired') {
    return 'read';
  }
  return 'none';
}

export type SetUpRefusal =
  | 'licence_not_found'
  | 'licence_used'
  | 'licence_not_active'
  | 'licence_not_yours';

/** Why this person may not set a workspace up under the licence, or null when they may. */
export function setUpRefusal(
  licence: Licence | null,
  email: string,
): SetUpRefusal | null {
  if (!licence) return 'licence_not_found';
  if (licence.tenant) return 'licence_used';
  if (accessFor(licence) !== 'full') return 'licence_not_active';
  const mine = email.trim().toLowerCase();
  return licence.owners.some((owner) => owner.trim().toLowerCase() === mine)
    ? null
    : 'licence_not_yours';
}

export const SET_UP_MESSAGES: Record<SetUpRefusal, string> = {
  licence_not_found:
    'Harbour is open to licensed businesses only. Use the link we sent you, or contact us.',
  licence_used: 'This licence has already been used to set up a workspace.',
  licence_not_active: 'This licence is not active. Contact us.',
  licence_not_yours:
    'This licence was issued to another email address. Sign up with that address.',
};

/** The plan limits a licence can set, by the names the plan rules use. */
export type LicenceLimit = 'activeStaff' | 'importJobsPerMonth';

/** A licence's own ceiling for a plan limit, or null when it sets none. */
export function licenceLimit(
  licence: Licence | null,
  limit: LicenceLimit,
): number | null {
  if (!licence) return null;
  return limit === 'activeStaff'
    ? licence.seats
    : (licence.limits.importJobsPerMonth ?? null);
}
