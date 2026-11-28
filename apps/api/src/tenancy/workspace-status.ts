import type { Prisma } from '@prisma/client';

/** False while a platform operator has a workspace suspended. */
export async function workspaceIsActive(
  prisma: Prisma.TransactionClient,
  organisationId: string,
): Promise<boolean> {
  const organisation = await prisma.organisation.findUnique({
    where: { id: organisationId },
    select: { status: true },
  });
  return organisation?.status === 'ACTIVE';
}
