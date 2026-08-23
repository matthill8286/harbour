import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FlespiGpsClient } from './flespi-gps.client';
import { parseFlespiBatch, type FlespiPing } from './flespi-message';

@Injectable()
export class FlespiIngestService {
  private readonly logger = new Logger(FlespiIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flespi: FlespiGpsClient,
  ) {}

  async ingestBody(body: unknown) {
    const pings = parseFlespiBatch(body);
    let accepted = 0;
    let skipped = 0;
    let unknown = 0;
    for (const ping of pings) {
      const result = await this.ingestPing(ping);
      accepted += result.accepted;
      skipped += result.skipped;
      unknown += result.unknown;
    }
    return { received: pings.length, accepted, skipped, unknown };
  }

  async syncTracker(organisationId: string, trackerId: string) {
    const tracker = await this.prisma.tracker.findFirst({
      where: { id: trackerId, organisationId },
    });
    if (!tracker) {
      throw new NotFoundException('Tracker not found');
    }
    if (tracker.provider !== 'flespi') {
      throw new BadRequestException('Only Flespi trackers can be synced from the gateway');
    }
    if (!this.flespi.configured()) {
      throw new BadRequestException('FLESPI_TOKEN is not configured');
    }
    const pings = await this.flespi.latestForImei(tracker.serialNumber);
    let accepted = 0;
    let skipped = 0;
    for (const ping of pings) {
      const result = await this.ingestPing(ping, tracker.id);
      accepted += result.accepted;
      skipped += result.skipped;
    }
    return { received: pings.length, accepted, skipped };
  }

  private async ingestPing(ping: FlespiPing, trackerId?: string) {
    const trackers = await this.prisma.tracker.findMany({
      where: trackerId
        ? { id: trackerId }
        : { serialNumber: ping.ident },
      include: { assignments: { where: { removedAt: null }, take: 1 } },
    });
    if (trackers.length === 0) {
      this.logger.debug(`No Harbour tracker registered for IMEI ${ping.ident}`);
      return { accepted: 0, skipped: 0, unknown: 1 };
    }
    let accepted = 0;
    let skipped = 0;
    for (const tracker of trackers) {
      const duplicate = await this.prisma.locationEvent.findFirst({
        where: { trackerId: tracker.id, recordedAt: ping.recordedAt },
        select: { id: true },
      });
      if (duplicate) {
        skipped += 1;
        continue;
      }
      const assignment = tracker.assignments[0];
      if (assignment) {
        await this.prisma.locationEvent.create({
          data: {
            organisationId: tracker.organisationId,
            trackerId: tracker.id,
            vehicleId: assignment.vehicleId,
            importJobId: assignment.importJobId,
            latitude: ping.latitude,
            longitude: ping.longitude,
            accuracy: ping.accuracy,
            speed: ping.speed,
            heading: ping.heading,
            recordedAt: ping.recordedAt,
          },
        });
      }
      await this.prisma.tracker.update({
        where: { id: tracker.id },
        data: {
          lastSeenAt: ping.recordedAt,
          batteryLevel: ping.batteryLevel ?? tracker.batteryLevel,
          status: assignment ? 'ASSIGNED' : tracker.status === 'OFFLINE' ? 'AVAILABLE' : tracker.status,
        },
      });
      accepted += 1;
    }
    return { accepted, skipped, unknown: 0 };
  }
}
