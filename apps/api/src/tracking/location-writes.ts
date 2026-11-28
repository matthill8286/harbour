import type { LocationSource, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

const BATCH = 500;

export type Ping = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  recordedAt: Date;
  batteryLevel?: number | null;
  supplyVoltage?: number | null;
};

export type Delivery = {
  tracker: { id: string; organisationId: string };
  pings: Ping[];
};

type Assignment = {
  organisationId: string;
  trackerId: string;
  vehicleId: string;
  importJobId: string | null;
  assignedAt: Date;
  removedAt: Date | null;
};

/** The assignment that was running when the ping was recorded, if any. */
function assignmentAt(assignments: Assignment[], at: Date) {
  return assignments.find(
    (a) => a.assignedAt <= at && (a.removedAt == null || at < a.removedAt),
  );
}

/** A reading too large for its column is dropped, so it cannot fail a batch. */
const reading = (value: number | null | undefined, limit: number) =>
  value == null || Math.abs(value) >= limit ? null : value;

/**
 * Saves pings in batches. A ping joins a job only if the tracker was on that job
 * when it was recorded. A ping already saved for the same tracker and time is
 * skipped by the unique index, even when two deliveries run at once.
 * With `keepUnassigned` off, a ping from outside every assignment is not stored.
 */
export async function savePings(
  prisma: PrismaService,
  deliveries: Delivery[],
  {
    keepUnassigned,
    source = 'GATEWAY',
  }: { keepUnassigned: boolean; source?: LocationSource },
) {
  const result = { saved: 0, duplicates: 0, unassigned: 0 };
  const live = deliveries.filter((d) => d.pings.length > 0);
  if (live.length === 0) return result;
  const earliest = new Date(
    live.reduce(
      (min, d) =>
        d.pings.reduce((m, p) => Math.min(m, p.recordedAt.getTime()), min),
      Infinity,
    ),
  );
  const assignments = await prisma.trackerAssignment.findMany({
    where: {
      trackerId: { in: live.map((d) => d.tracker.id) },
      OR: [{ removedAt: null }, { removedAt: { gt: earliest } }],
    },
    orderBy: { assignedAt: 'desc' },
  });

  const rows: Prisma.LocationEventCreateManyInput[] = [];
  for (const { tracker, pings } of live) {
    const own = assignments.filter(
      (a) =>
        a.trackerId === tracker.id &&
        a.organisationId === tracker.organisationId,
    );
    const seen = new Set<number>();
    for (const ping of pings) {
      const assignment = assignmentAt(own, ping.recordedAt);
      if (!assignment && !keepUnassigned) {
        result.unassigned += 1;
        continue;
      }
      const time = ping.recordedAt.getTime();
      if (seen.has(time)) {
        result.duplicates += 1;
        continue;
      }
      seen.add(time);
      rows.push({
        organisationId: tracker.organisationId,
        trackerId: tracker.id,
        vehicleId: assignment?.vehicleId,
        importJobId: assignment?.importJobId,
        latitude: ping.latitude,
        longitude: ping.longitude,
        accuracy: reading(ping.accuracy, 1e6),
        speed: reading(ping.speed, 1e6),
        heading: reading(ping.heading, 1e4),
        recordedAt: ping.recordedAt,
        source,
      });
    }
  }
  // One order for every delivery, so two overlapping inserts cannot deadlock.
  rows.sort(
    (a, b) =>
      String(a.trackerId).localeCompare(String(b.trackerId)) ||
      new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  );
  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH);
    const { count } = await prisma.locationEvent.createMany({
      data: batch,
      skipDuplicates: true,
    });
    result.saved += count;
    result.duplicates += batch.length - count;
  }
  for (const delivery of live) await markSeen(prisma, delivery);
  return result;
}

/**
 * `lastSeenAt` and the battery only move forwards: each write applies only when
 * the stored time is older. A device clock ahead of ours counts as now.
 */
async function markSeen(prisma: PrismaService, { tracker, pings }: Delivery) {
  const newest = pings.reduce((a, b) => (b.recordedAt > a.recordedAt ? b : a));
  const seenAt = new Date(Math.min(newest.recordedAt.getTime(), Date.now()));
  await prisma.tracker.updateMany({
    where: {
      id: tracker.id,
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: seenAt } }],
    },
    data: {
      lastSeenAt: seenAt,
      ...(newest.batteryLevel == null
        ? {}
        : { batteryLevel: newest.batteryLevel }),
      ...(newest.supplyVoltage == null
        ? {}
        : { supplyVoltage: newest.supplyVoltage }),
    },
  });
  // A unit that was silent is back. The database decides whether it is on a
  // job, so an assignment changed at the same moment is not overwritten.
  await prisma.tracker.updateMany({
    where: {
      id: tracker.id,
      status: 'OFFLINE',
      assignments: { some: { removedAt: null } },
    },
    data: { status: 'ASSIGNED' },
  });
  await prisma.tracker.updateMany({
    where: {
      id: tracker.id,
      status: 'OFFLINE',
      assignments: { none: { removedAt: null } },
    },
    data: { status: 'AVAILABLE' },
  });
}
