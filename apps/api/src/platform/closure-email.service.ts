import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import type { ClosureEmail } from '@prisma/client';
import { NotificationsService } from '../integrations/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const FIRST_RUN_MS = 60 * 1000;
const EVERY_MS = 15 * 60 * 1000;
/** A row taken this long ago by a run that never finished may be taken again. */
export const CLAIM_EXPIRES_MS = 60 * 60 * 1000;
const BATCH = 50;

/**
 * Sends the emails that the operator's `close` and `cancel-close` commands
 * queue for a workspace's active Admins: the closure, the reminder before the
 * deletion, and the cancellation.
 *
 * Each row is taken before it is sent, so two copies of the api never send the
 * same one, and each Admin it reaches is recorded, so a retry skips them. A row
 * that fails is let go and tried again on a later run. Rows for a suspended
 * workspace wait until it is restored. A cancelled closure's rows are deleted,
 * and an email checks before it goes that its row is still there.
 */
@Injectable()
export class ClosureEmailService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ClosureEmailService.name);
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap() {
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
      void this.sendDue()
        .catch((error: unknown) =>
          this.logger.error('Could not send closure emails', error as Error),
        )
        .finally(() => this.schedule(EVERY_MS));
    }, delay);
    this.timer.unref();
  }

  /** Sends every email that is due, and says how many rows went and failed. */
  async sendDue(now = new Date()) {
    const due = await this.prisma.closureEmail.findMany({
      where: {
        sentAt: null,
        dueAt: { lte: now },
        organisation: { status: 'ACTIVE' },
        OR: [
          { claimedAt: null },
          { claimedAt: { lt: new Date(now.getTime() - CLAIM_EXPIRES_MS) } },
        ],
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
      take: BATCH,
    });
    let sent = 0;
    let failed = 0;
    for (const row of due) {
      if (this.stopped) break;
      const claimed = await this.claim(row.id, now);
      if (!claimed) continue;
      try {
        await this.send(claimed);
        sent += 1;
      } catch (error) {
        const { count } = await this.prisma.closureEmail.updateMany({
          where: { id: row.id, sentAt: null },
          data: { claimedAt: null },
        });
        // Gone: the closure was cancelled or scheduled again meanwhile.
        if (count === 0) continue;
        failed += 1;
        // Ids only: the logs keep no addresses.
        this.logger.warn(
          `Failed CLOSURE_${row.kind} organisation=${row.organisationId}: ${
            error instanceof Error ? error.message : String(error)
          }. It will be tried again.`,
        );
      }
    }
    return { sent, failed };
  }

  /**
   * Takes the row, unless another run has it or it is gone, and reads it again
   * to see who another run already reached.
   */
  private async claim(id: string, now: Date) {
    const { count } = await this.prisma.closureEmail.updateMany({
      where: {
        id,
        sentAt: null,
        OR: [
          { claimedAt: null },
          { claimedAt: { lt: new Date(now.getTime() - CLAIM_EXPIRES_MS) } },
        ],
      },
      data: { claimedAt: now },
    });
    return count === 1
      ? this.prisma.closureEmail.findUnique({ where: { id } })
      : null;
  }

  private async send(row: ClosureEmail) {
    const organisation = await this.prisma.organisation.findUnique({
      where: { id: row.organisationId },
      select: {
        name: true,
        settings: { select: { brandName: true } },
        memberships: {
          where: { status: 'ACTIVE', role: 'ADMIN' },
          select: { user: { select: { id: true, email: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!organisation) return;
    const workspaceName =
      organisation.settings?.brandName?.trim() || organisation.name;
    const stillWanted = async () =>
      (await this.prisma.closureEmail.count({ where: { id: row.id } })) === 1;
    for (const { user } of organisation.memberships) {
      if (row.sentToUserIds.includes(user.id)) continue;
      await this.notifications.sendClosureEmail({
        organisationId: row.organisationId,
        to: user.email,
        kind: row.kind,
        workspaceName,
        contractEndsAt: row.contractEndsAt,
        deleteAfter: row.deleteAfter,
        stillWanted,
      });
      await this.prisma.closureEmail.updateMany({
        where: { id: row.id },
        data: { sentToUserIds: { push: user.id } },
      });
    }
    await this.prisma.closureEmail.updateMany({
      where: { id: row.id },
      data: { sentAt: new Date() },
    });
  }
}
