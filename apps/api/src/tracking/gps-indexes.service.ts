import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { imeiKeySql, realProviderSql } from '../integrations/gps-device';

export const REAL_IMEI_INDEX = 'Tracker_realImei_key';
export const PING_INDEX = 'LocationEvent_trackerId_recordedAt_key';

/**
 * Makes the two unique indexes that `prisma db push` cannot add without
 * `--accept-data-loss`. Both are partial, so `db push` does not see them and
 * leaves them in place. It runs before the API listens, and a failure stops the
 * start: ingestion must not run without these rules.
 *
 * Nothing is deleted. Rows that break a rule are marked first, in the same
 * transaction, and then left out of the index.
 */
@Injectable()
export class GpsIndexesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GpsIndexesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await this.ensure();
  }

  async ensure() {
    const marked = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('gps-indexes'))`;
        return {
          claims: await this.uniqueRealImei(tx),
          pings: await this.uniquePings(tx),
        };
      },
      // Long enough to index a large ping table.
      { maxWait: 60_000, timeout: 600_000 },
    );
    if (marked.pings) {
      this.logger.warn(
        `Marked ${marked.pings} duplicate GPS pings. They are kept and left out of trails.`,
      );
    }
    const disputed = await this.prisma.tracker.count({
      where: { imeiConflictAt: { not: null } },
    });
    if (disputed) {
      this.logger.warn(
        `${disputed} tracker registrations are in an IMEI dispute (${marked.claims} new). ` +
          'They receive no positions. Confirm each owner with confirm-device-owner.',
      );
    }
    return marked;
  }

  /**
   * Where a real IMEI is registered more than once, every claim is disputed.
   * Being first is not proof of ownership, so none of them wins.
   */
  private async uniqueRealImei(tx: Prisma.TransactionClient) {
    if (await this.exists(tx, REAL_IMEI_INDEX)) return 0;
    await tx.$executeRaw`LOCK TABLE "Tracker" IN SHARE ROW EXCLUSIVE MODE`;
    const marked = await tx.$executeRaw`
      UPDATE "Tracker"
      SET "imeiConflictAt" = now(), "ownershipConfirmedAt" = NULL
      WHERE ${realProviderSql} AND "imeiConflictAt" IS NULL AND ${imeiKeySql} IN (
        SELECT ${imeiKeySql} FROM "Tracker"
        WHERE ${realProviderSql} AND "imeiConflictAt" IS NULL
        GROUP BY 1 HAVING count(*) > 1
      )`;
    await tx.$executeRaw`
      CREATE UNIQUE INDEX ${Prisma.raw(`"${REAL_IMEI_INDEX}"`)}
      ON "Tracker" ((${imeiKeySql}))
      WHERE ${realProviderSql} AND "imeiConflictAt" IS NULL`;
    return marked;
  }

  /** Keeps one copy of each ping, preferring one that is on a job. */
  private async uniquePings(tx: Prisma.TransactionClient) {
    if (await this.exists(tx, PING_INDEX)) return 0;
    await tx.$executeRaw`LOCK TABLE "LocationEvent" IN SHARE ROW EXCLUSIVE MODE`;
    const marked = await tx.$executeRaw`
      UPDATE "LocationEvent" SET "isDuplicate" = true
      WHERE "id" IN (
        SELECT "id" FROM (
          SELECT "id", row_number() OVER (
            PARTITION BY "trackerId", "recordedAt"
            ORDER BY ("importJobId" IS NULL), "receivedAt", "id"
          ) AS copy
          FROM "LocationEvent"
          WHERE "trackerId" IS NOT NULL AND NOT "isDuplicate"
        ) AS pings
        WHERE copy > 1
      )`;
    // This index also serves every lookup by tracker and time.
    await tx.$executeRaw`
      CREATE UNIQUE INDEX ${Prisma.raw(`"${PING_INDEX}"`)}
      ON "LocationEvent" ("trackerId", "recordedAt")
      WHERE "trackerId" IS NOT NULL AND NOT "isDuplicate"`;
    return marked;
  }

  private async exists(tx: Prisma.TransactionClient, index: string) {
    const [row] = await tx.$queryRaw<Array<{ found: boolean }>>`
      SELECT to_regclass(${`"${index}"`}) IS NOT NULL AS found`;
    return row.found;
  }
}
