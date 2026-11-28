export function presentOrganisation(org: {
  id: string;
  name: string;
  legalName: string | null;
  slug: string;
  timezone: string;
  currency: string;
  country: string;
  status: string;
  settings: { brandName: string | null; primaryContact: string | null } | null;
  subscription: { plan: string; status: string; billingCycle: string } | null;
  features: Array<{ flag: string; enabled: boolean }>;
  /** Set when the contract has ended and the data waits to be deleted. */
  closure?: { contractEndsAt: Date; deleteAfter: Date } | null;
}) {
  return {
    id: org.id,
    name: org.name,
    legalName: org.legalName,
    slug: org.slug,
    timezone: org.timezone,
    currency: org.currency,
    country: org.country,
    status: org.status,
    brandName: org.settings?.brandName?.trim() || org.name,
    primaryContact: org.settings?.primaryContact ?? null,
    subscription: org.subscription
      ? {
          plan: org.subscription.plan,
          status: org.subscription.status,
          billingCycle: org.subscription.billingCycle,
        }
      : null,
    closure: org.closure
      ? {
          contractEndsAt: org.closure.contractEndsAt,
          deleteAfter: org.closure.deleteAfter,
        }
      : null,
    features: Object.fromEntries(
      org.features.map((item) => [item.flag, item.enabled]),
    ),
  };
}
