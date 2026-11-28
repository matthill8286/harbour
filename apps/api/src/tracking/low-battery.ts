import type { PrismaService } from '../prisma/prisma.service';
import { BATTERY_RECHARGED_MARGIN } from './tracker-thresholds';

export type LowBattery = {
  organisationId: string;
  importJobId: string;
  reference: string;
  serialNumber: string;
  batteryLevel: number;
};

/**
 * Finds battery units on a job whose battery has just dropped to the
 * threshold, and marks each one so that its team is told once. A unit that is
 * charged again is unmarked, so a later drop is reported too. Each mark is
 * claimed on its own, so two deliveries at once cannot both report it.
 */
export async function claimLowBatteries(
  prisma: PrismaService,
  trackerIds: string[],
  thresholdPercent: number,
): Promise<LowBattery[]> {
  if (trackerIds.length === 0) return [];
  await prisma.trackerAssignment.updateMany({
    where: {
      trackerId: { in: trackerIds },
      removedAt: null,
      lowBatteryAlertedAt: { not: null },
      tracker: {
        batteryLevel: { gt: thresholdPercent + BATTERY_RECHARGED_MARGIN },
      },
    },
    data: { lowBatteryAlertedAt: null },
  });
  const low = await prisma.trackerAssignment.findMany({
    where: {
      trackerId: { in: trackerIds },
      removedAt: null,
      lowBatteryAlertedAt: null,
      importJobId: { not: null },
      tracker: {
        powerSource: 'BATTERY',
        batteryLevel: { lte: thresholdPercent },
      },
    },
    select: {
      id: true,
      organisationId: true,
      importJob: { select: { id: true, reference: true } },
      tracker: { select: { serialNumber: true, batteryLevel: true } },
    },
  });
  const claimed: LowBattery[] = [];
  for (const item of low) {
    const { count } = await prisma.trackerAssignment.updateMany({
      where: { id: item.id, lowBatteryAlertedAt: null },
      data: { lowBatteryAlertedAt: new Date() },
    });
    if (count === 0 || !item.importJob) continue;
    claimed.push({
      organisationId: item.organisationId,
      importJobId: item.importJob.id,
      reference: item.importJob.reference,
      serialNumber: item.tracker.serialNumber,
      batteryLevel: item.tracker.batteryLevel ?? 0,
    });
  }
  return claimed;
}
