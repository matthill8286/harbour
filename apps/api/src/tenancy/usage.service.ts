import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { monthStartUtc } from './tenant-keys';
import {
  assertWithinPlan,
  PLAN_LIMITS,
  type PlanLimitTable,
} from './plan-policy';

@Injectable()
export class UsageService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsageService.name);
  planLimits: PlanLimitTable = PLAN_LIMITS;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Counts uncounted jobs at every start. A failure stops the start, so it
   * cannot go unnoticed while usage stays wrong.
   */
  async onApplicationBootstrap() {
    try {
      await this.backfillImportJobs();
    } catch (error) {
      this.logger.error('Could not backfill import job usage', error as Error);
      throw error;
    }
  }

  /** Pass the transaction that creates the job, so both are saved or neither is. */
  async incrementImportJobs(
    organisationId: string,
    at = new Date(),
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const periodStart = monthStartUtc(at);
    const record = await db.usageRecord.upsert({
      where: {
        organisationId_metric_periodStart: {
          organisationId,
          metric: 'IMPORT_JOBS',
          periodStart,
        },
      },
      update: { quantity: { increment: 1 } },
      create: {
        organisationId,
        metric: 'IMPORT_JOBS',
        periodStart,
        quantity: 1,
      },
    });
    // Inside the caller's transaction, so a refused job leaves no count behind.
    await assertWithinPlan(
      db,
      organisationId,
      'importJobsPerMonth',
      () => record.quantity,
      this.planLimits,
    );
    return record;
  }

  /**
   * Raises each workspace's monthly count to the number of jobs created in that
   * UTC month. It never lowers a count, so usage stays recorded if a job is
   * later deleted, and running it again changes nothing.
   */
  async backfillImportJobs() {
    const changed = await this.prisma.$transaction(
      async (tx) => {
        // Holds off new increments until the jobs have been counted, so a job
        // created during the backfill is not lost from the total.
        await tx.$executeRaw`LOCK TABLE "UsageRecord" IN SHARE ROW EXCLUSIVE MODE`;
        return tx.$executeRaw`
          INSERT INTO "UsageRecord" ("id", "organisationId", "metric", "periodStart", "quantity")
          SELECT
            'usage_' || md5("organisationId" || date_trunc('month', "createdAt")::text),
            "organisationId",
            'IMPORT_JOBS'::"UsageMetric",
            date_trunc('month', "createdAt"),
            count(*)::int
          FROM "ImportJob"
          GROUP BY "organisationId", date_trunc('month', "createdAt")
          ON CONFLICT ("organisationId", "metric", "periodStart")
          DO UPDATE SET "quantity" = EXCLUDED."quantity"
          WHERE "UsageRecord"."quantity" < EXCLUDED."quantity"
        `;
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
    if (changed) this.logger.log(`Backfilled ${changed} monthly usage records`);
    return changed;
  }
}
