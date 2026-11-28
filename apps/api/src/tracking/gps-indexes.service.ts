import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const REAL_IMEI_INDEX = 'Tracker_realImei_key';
export const PING_INDEX = 'LocationEvent_trackerId_recordedAt_key';

/**
 * Checks for the two partial unique indexes that ingestion depends on. The
 * migrations make them (prisma/migrations), because schema.prisma cannot
 * describe them. It runs before the API listens, and a missing or invalid index
 * stops the start: ingestion must not run without these rules.
 */
@Injectable()
export class GpsIndexesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GpsIndexesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await this.verify();
    const disputed = await this.prisma.tracker.count({
      where: { imeiConflictAt: { not: null } },
    });
    if (disputed) {
      this.logger.warn(
        `${disputed} tracker registrations are in an IMEI dispute. ` +
          'They receive no positions. Confirm each owner with confirm-device-owner.',
      );
    }
  }

  async verify() {
    const missing: string[] = [];
    for (const name of [REAL_IMEI_INDEX, PING_INDEX]) {
      const [row] = await this.prisma.$queryRaw<Array<{ found: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_index
          WHERE indexrelid = to_regclass(${`"${name}"`})
            AND indisunique AND indisvalid
        ) AS found`;
      if (!row.found) missing.push(name);
    }
    if (missing.length) {
      const message =
        `The database is missing ${missing.join(' and ')}. ` +
        'Apply the migrations with `node prisma/migrate.cjs deploy`.';
      this.logger.error(message);
      throw new Error(message);
    }
  }
}
