import { Prisma, type LocationEvent } from '@prisma/client';

type Raw = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * The newest ping of each job, in one query. Prisma applies a nested `take`
 * only after reading every row, so asking for it through the job would load
 * whole trails. This reads one index entry per job.
 */
export async function latestPositions(
  db: Raw,
  organisationId: string,
  jobIds: string[],
) {
  if (jobIds.length === 0) return new Map<string, LocationEvent>();
  const rows = await db.$queryRaw<LocationEvent[]>(Prisma.sql`
    SELECT latest.*
    FROM unnest(${jobIds}::text[]) AS job(id)
    CROSS JOIN LATERAL (
      SELECT * FROM "LocationEvent" event
      WHERE event."importJobId" = job.id
        AND event."organisationId" = ${organisationId}
        AND NOT event."isDuplicate"
      ORDER BY event."recordedAt" DESC
      LIMIT 1
    ) latest`);
  return new Map(rows.map((row) => [row.importJobId as string, row]));
}
