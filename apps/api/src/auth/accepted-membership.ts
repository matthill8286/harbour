import type { PrismaService } from '../prisma/prisma.service';

type Membership = {
  organisationId: string;
  userId: string;
  acceptedAt: Date | null;
};

/**
 * Whether the person has ever accepted this staff membership. Memberships
 * accepted before `acceptedAt` was added are recognised by their used invite.
 */
export async function staffMembershipWasAccepted(
  prisma: PrismaService,
  { organisationId, userId, acceptedAt }: Membership,
) {
  if (acceptedAt) return true;
  const used = await prisma.staffInvite.findFirst({
    where: { organisationId, userId, acceptedAt: { not: null } },
    select: { id: true },
  });
  return Boolean(used);
}

/** The same for a customer's portal access to one customer record. */
export async function portalMembershipWasAccepted(
  prisma: PrismaService,
  {
    organisationId,
    userId,
    customerId,
    acceptedAt,
  }: Membership & { customerId: string },
) {
  if (acceptedAt) return true;
  const used = await prisma.portalInvite.findFirst({
    where: {
      organisationId,
      userId,
      customerId,
      acceptedAt: { not: null },
    },
    select: { id: true },
  });
  return Boolean(used);
}
