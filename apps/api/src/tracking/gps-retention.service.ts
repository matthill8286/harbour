import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { TERMINAL_STATUSES } from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import { gpsRetentionDays } from './gps-retention';

const BATCH = 1000;
const FIRST_RUN_MS = 60 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes raw GPS points once they are older than the retention period:
 * - on a completed or cancelled job, that long after the job was closed;
 * - on no job, that long after the point was recorded.
 * Points on an open job are kept. Nothing but GPS points is changed.
 * It is safe to run again, or in two copies of the API at once.
 */
@Injectable()
export class GpsRetentionService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(GpsRetentionService.name);
  private readonly days: number;
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    // Read at construction, so an unsafe value stops the API from starting.
    this.days = gpsRetentionDays(config.get<string>('GPS_RETENTION_DAYS'));
  }

  onApplicationBootstrap() {
    this.logger.log(`GPS points are kept for ${this.days} days`);
    this.schedule(FIRST_RUN_MS);
  }

  onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** The next run is set only when this one ends, so runs never overlap. */
  private schedule(delay: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.purge()
        .catch((error: unknown) =>
          this.logger.error('Could not delete old GPS points', error as Error),
        )
        .finally(() => this.schedule(EVERY_MS));
    }, delay);
    this.timer.unref();
  }

  async purge(now = new Date()) {
    // The columns hold UTC without a time zone, whatever the session's zone is.
    const cutoff = Prisma.sql`${new Date(now.getTime() - this.days * DAY_MS).toISOString()}::timestamp`;
    // The job rows are locked while a batch is deleted. A job reopened at the
    // same moment is checked again after the change, and its points are kept.
    const closedJobs = await this.inBatches(Prisma.sql`
      SELECT e."id" FROM "LocationEvent" e
      JOIN "ImportJob" j ON j."id" = e."importJobId"
      WHERE j."status" IN (${Prisma.join([...TERMINAL_STATUSES])})
        AND COALESCE(j."completedAt", j."updatedAt") < ${cutoff}
      LIMIT ${BATCH}
      FOR UPDATE OF e SKIP LOCKED
      FOR SHARE OF j`);
    const noJob = await this.inBatches(Prisma.sql`
      SELECT "id" FROM "LocationEvent"
      WHERE "importJobId" IS NULL AND "recordedAt" < ${cutoff}
      LIMIT ${BATCH}
      FOR UPDATE SKIP LOCKED`);
    if (closedJobs || noJob) {
      // Counts only: no positions or device numbers belong in the logs.
      this.logger.log(
        `Deleted ${closedJobs} GPS points from closed jobs and ${noJob} with no job`,
      );
    }
    return { closedJobs, noJob };
  }

  /** Each batch is its own short transaction. */
  private async inBatches(select: Prisma.Sql) {
    let total = 0;
    let deleted: number;
    do {
      deleted = await this.prisma.$executeRaw`
        WITH doomed AS MATERIALIZED (${select})
        DELETE FROM "LocationEvent" WHERE "id" IN (SELECT "id" FROM doomed)`;
      total += deleted;
    } while (deleted === BATCH && !this.stopped);
    return total;
  }
}
