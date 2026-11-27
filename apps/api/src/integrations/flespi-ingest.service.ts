import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { savePings } from '../tracking/location-writes';
import { FlespiGpsClient } from './flespi-gps.client';
import { parseFlespiBatch, type FlespiPing } from './flespi-message';
import { imeiKey, imeiKeySql, realProviderSql } from './gps-device';

/** A ping dated further ahead than this has a broken clock and is dropped. */
const MAX_CLOCK_AHEAD_MS = 24 * 60 * 60 * 1000;

type Device = {
  id: string;
  organisationId: string;
  ownershipConfirmedAt: Date;
  key: string;
};

@Injectable()
export class FlespiIngestService {
  private readonly logger = new Logger(FlespiIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flespi: FlespiGpsClient,
  ) {}

  ingestBody(body: unknown) {
    return this.deliver(parseFlespiBatch(body));
  }

  async syncTracker(organisationId: string, trackerId: string) {
    const tracker = await this.prisma.tracker.findFirst({
      where: { id: trackerId, organisationId },
    });
    if (!tracker) {
      throw new NotFoundException('Tracker not found');
    }
    if (tracker.provider !== 'flespi') {
      throw new BadRequestException(
        'Only Flespi trackers can be synced from the gateway',
      );
    }
    // Checked before the gateway is asked: the account is shared by every
    // workspace, so only a confirmed owner may read a device from it.
    if (!tracker.ownershipConfirmedAt || tracker.imeiConflictAt) {
      throw new ForbiddenException(
        'Positions start once the platform operator has confirmed that your workspace owns this unit.',
      );
    }
    if (!this.flespi.configured()) {
      throw new BadRequestException('FLESPI_TOKEN is not configured');
    }
    const key = imeiKey(tracker.serialNumber);
    const pings = await this.flespi.latestForImei(tracker.serialNumber);
    const { received, accepted, skipped } = await this.deliver(
      pings.filter((ping) => imeiKey(ping.ident) === key),
      tracker.id,
    );
    return { received, accepted, skipped };
  }

  /**
   * Gives each ping to the one tracker confirmed to own its IMEI, and to nobody
   * when there is no such tracker. With `onlyTrackerId`, no other tracker can
   * receive anything.
   */
  private async deliver(pings: FlespiPing[], onlyTrackerId?: string) {
    const devices = await this.owners(pings, onlyTrackerId);
    const latest = Date.now() + MAX_CLOCK_AHEAD_MS;
    const deliveries = new Map<
      string,
      { tracker: Device; pings: FlespiPing[] }
    >();
    let unknown = 0;
    let refused = 0;
    for (const ping of pings) {
      const device = devices.get(imeiKey(ping.ident));
      if (!device) {
        unknown += 1;
        continue;
      }
      // Anything recorded before ownership was confirmed may be another
      // holder's journey.
      if (
        ping.recordedAt < device.ownershipConfirmedAt ||
        ping.recordedAt.getTime() > latest
      ) {
        refused += 1;
        continue;
      }
      const delivery = deliveries.get(device.id) ?? {
        tracker: device,
        pings: [],
      };
      delivery.pings.push(ping);
      deliveries.set(device.id, delivery);
    }
    if (unknown) {
      this.logger.debug(`${unknown} pings had no confirmed Harbour tracker`);
    }
    const result = await savePings(this.prisma, [...deliveries.values()], {
      keepUnassigned: false,
    });
    return {
      received: pings.length,
      // A ping from outside every assignment still counts: it is a heartbeat.
      accepted: result.saved + result.unassigned,
      skipped: result.duplicates + refused,
      unknown,
    };
  }

  private async owners(pings: FlespiPing[], onlyTrackerId?: string) {
    const keys = [...new Set(pings.map((ping) => imeiKey(ping.ident)))];
    if (keys.length === 0) return new Map<string, Device>();
    const rows = await this.prisma.$queryRaw<Device[]>`
      SELECT "id", "organisationId", "ownershipConfirmedAt", ${imeiKeySql} AS "key"
      FROM "Tracker"
      WHERE ${realProviderSql}
        AND "imeiConflictAt" IS NULL
        AND "ownershipConfirmedAt" IS NOT NULL
        AND ${imeiKeySql} IN (${Prisma.join(keys)})`;
    const owners = new Map<string, Device>();
    for (const row of rows) {
      // The unique index allows one. If there are ever two, neither receives.
      if (rows.filter((other) => other.key === row.key).length > 1) {
        this.logger.error(`Tracker ${row.id} shares its IMEI. Nothing sent.`);
        continue;
      }
      if (!onlyTrackerId || row.id === onlyTrackerId) owners.set(row.key, row);
    }
    return owners;
  }
}
