import { Prisma } from '@prisma/client';
import {
  describeMinutes,
  MIN_NO_SIGNAL_MINUTES,
  MISSED_REPORTS_FOR_NO_SIGNAL,
  noSignalAfterMinutes,
  TERMINAL_STATUSES,
} from '@vip/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { SIMULATED_GPS_PROVIDERS } from '../integrations/gps-providers';
import {
  buildLowBatteryAlert,
  buildLowVehicleBatteryAlert,
  buildRemovalUnconfirmedAlert,
  buildReportingAfterJobAlert,
  buildStaleTrackerAlert,
  type OpsAlert,
} from './ops-alerts';

const CLOSED = [...TERMINAL_STATUSES];

export type TrackerAlertOptions = {
  organisationId: string;
  now: Date;
  routeId?: string;
  /** How many alerts of each kind are listed. The rest are counted. */
  perKind: number;
  lowBatteryPercent: number;
  lowSupplyVolts: number;
  afterJobGraceHours: number;
};

type Row = {
  importJobId: string;
  reference: string;
  serialNumber: string;
  lastSeenAt: Date | null;
  reportIntervalMinutes: number;
  batteryLevel: number | null;
  supplyVoltage: number | null;
  stillAssigned: boolean;
  total: bigint;
};

/**
 * The tracker alerts on the Board, each kind listed up to `perKind` and
 * counted in full:
 * - a unit on an open job that missed two of its own expected reports;
 * - a battery unit on an open job at or below the low-battery level;
 * - a wired unit on an open job reading a low vehicle battery;
 * - a real unit that came off a job and is not confirmed as taken out, or is
 *   still assigned to a closed job;
 * - a unit that is still reporting a day after it came off its last job.
 */
export async function trackerAlerts(
  prisma: PrismaService,
  options: TrackerAlertOptions,
): Promise<{ shown: OpsAlert[]; total: number }> {
  const { organisationId, perKind } = options;
  const at = Prisma.sql`${options.now.toISOString()}::timestamp`;
  const onRoute = options.routeId
    ? Prisma.sql`AND j."routeId" = ${options.routeId}`
    : Prisma.empty;
  const open = Prisma.sql`j."status" NOT IN (${Prisma.join(CLOSED)})`;
  const columns = Prisma.sql`
    j."id" AS "importJobId", j."reference", t."serialNumber", t."lastSeenAt",
    t."reportIntervalMinutes", t."batteryLevel", t."supplyVoltage",
    COUNT(*) OVER () AS "total"`;
  const onJob = Prisma.sql`
    FROM "TrackerAssignment" a
    JOIN "Tracker" t ON t."id" = a."trackerId"
    JOIN "ImportJob" j ON j."id" = a."importJobId"
    WHERE a."organisationId" = ${organisationId}
      AND j."organisationId" = ${organisationId}
      ${onRoute}`;

  const [quiet, lowBattery, lowSupply, unremoved, afterJob] = await Promise.all(
    [
      prisma.$queryRaw<Row[]>`
        SELECT ${columns}, false AS "stillAssigned" ${onJob}
          AND a."removedAt" IS NULL AND ${open}
          AND (
            t."status" = 'OFFLINE' OR t."lastSeenAt" IS NULL
            OR t."lastSeenAt" <= ${at} - make_interval(mins => GREATEST(
              ${MIN_NO_SIGNAL_MINUTES}::int,
              ${MISSED_REPORTS_FOR_NO_SIGNAL}::int * t."reportIntervalMinutes"
            ))
          )
        ORDER BY t."lastSeenAt" ASC NULLS FIRST, a."id"
        LIMIT ${perKind}`,
      prisma.$queryRaw<Row[]>`
        SELECT ${columns}, false AS "stillAssigned" ${onJob}
          AND a."removedAt" IS NULL AND ${open}
          AND t."powerSource" = 'BATTERY'
          AND t."batteryLevel" <= ${options.lowBatteryPercent}
        ORDER BY t."batteryLevel" ASC, a."id"
        LIMIT ${perKind}`,
      prisma.$queryRaw<Row[]>`
        SELECT ${columns}, false AS "stillAssigned" ${onJob}
          AND a."removedAt" IS NULL AND ${open}
          AND t."powerSource" IN ('HARD_WIRED', 'OBD')
          AND t."supplyVoltage" < ${options.lowSupplyVolts}
        ORDER BY t."supplyVoltage" ASC, a."id"
        LIMIT ${perKind}`,
      prisma.$queryRaw<Row[]>`
        SELECT ${columns}, (a."removedAt" IS NULL) AS "stillAssigned" ${onJob}
          AND (
            (a."removedAt" IS NOT NULL AND a."removalRequired"
              AND a."removalConfirmedAt" IS NULL)
            OR (a."removedAt" IS NULL AND NOT ${open}
              AND lower(btrim(t."provider")) NOT IN (${Prisma.join([...SIMULATED_GPS_PROVIDERS])}))
          )
        ORDER BY a."removedAt" ASC NULLS FIRST, a."id"
        LIMIT ${perKind}`,
      prisma.$queryRaw<Row[]>`
        SELECT j."id" AS "importJobId", j."reference", t."serialNumber",
          t."lastSeenAt", t."reportIntervalMinutes", t."batteryLevel",
          t."supplyVoltage", false AS "stillAssigned",
          COUNT(*) OVER () AS "total"
        FROM "Tracker" t
        CROSS JOIN LATERAL (
          SELECT a."importJobId", a."removedAt" FROM "TrackerAssignment" a
          WHERE a."trackerId" = t."id"
          ORDER BY a."assignedAt" DESC, a."id" DESC
          LIMIT 1
        ) latest
        JOIN "ImportJob" j ON j."id" = latest."importJobId"
        WHERE t."organisationId" = ${organisationId}
          AND j."organisationId" = ${organisationId}
          ${onRoute}
          AND latest."removedAt" IS NOT NULL
          AND t."lastSeenAt" > latest."removedAt"
            + make_interval(hours => ${options.afterJobGraceHours}::int)
        ORDER BY t."lastSeenAt" DESC, t."id"
        LIMIT ${perKind}`,
    ],
  );

  const count = (rows: Row[]) => Number(rows[0]?.total ?? 0);
  const shown: OpsAlert[] = [
    ...quiet.map((row) =>
      buildStaleTrackerAlert({
        importJobId: row.importJobId,
        reference: row.reference,
        trackerSerial: row.serialNumber,
        lastSeenAt: row.lastSeenAt,
        noSignalAfter: describeMinutes(
          noSignalAfterMinutes(row.reportIntervalMinutes),
        ),
      }),
    ),
    ...lowBattery.map((row) =>
      buildLowBatteryAlert({
        importJobId: row.importJobId,
        reference: row.reference,
        trackerSerial: row.serialNumber,
        batteryLevel: row.batteryLevel ?? 0,
      }),
    ),
    ...lowSupply.map((row) =>
      buildLowVehicleBatteryAlert({
        importJobId: row.importJobId,
        reference: row.reference,
        trackerSerial: row.serialNumber,
        volts: Number(row.supplyVoltage ?? 0),
      }),
    ),
    ...unremoved.map((row) =>
      buildRemovalUnconfirmedAlert({
        importJobId: row.importJobId,
        reference: row.reference,
        trackerSerial: row.serialNumber,
        stillAssigned: row.stillAssigned,
      }),
    ),
    ...afterJob.map((row) =>
      buildReportingAfterJobAlert({
        importJobId: row.importJobId,
        reference: row.reference,
        trackerSerial: row.serialNumber,
        lastSeenAt: row.lastSeenAt!,
      }),
    ),
  ];
  return {
    shown,
    total:
      count(quiet) +
      count(lowBattery) +
      count(lowSupply) +
      count(unremoved) +
      count(afterJob),
  };
}
