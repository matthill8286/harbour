import { randomBytes } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAX_GPS_RETENTION_DAYS, MIN_GPS_RETENTION_DAYS } from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { gpsRetentionDays } from '../tracking/gps-retention';
import { hashGatewaySecret } from '../integrations/workspace-gps-webhook.guard';

/**
 * A workspace's GPS settings: how long its positions are kept, and the secret
 * for posting positions from its own Flespi account.
 */
@Injectable()
export class GpsSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async get(user: AuthUser) {
    const organisation = await this.prisma.organisation.findUnique({
      where: { id: user.organisationId },
      select: {
        slug: true,
        settings: {
          select: { gpsRetentionDays: true, gpsWebhookSecretSetAt: true },
        },
      },
    });
    if (!organisation) throw new NotFoundException('Organisation not found');
    return {
      retentionDays: organisation.settings?.gpsRetentionDays ?? null,
      defaultRetentionDays: gpsRetentionDays(
        this.config.get<string>('GPS_RETENTION_DAYS'),
      ),
      minRetentionDays: MIN_GPS_RETENTION_DAYS,
      maxRetentionDays: MAX_GPS_RETENTION_DAYS,
      gatewaySecretSetAt: organisation.settings?.gpsWebhookSecretSetAt ?? null,
      gatewayUrl: this.gatewayUrl(organisation.slug),
    };
  }

  /** Null goes back to the platform's period. */
  async setRetention(user: AuthUser, retentionDays: number | null) {
    await this.prisma.organisationSettings.upsert({
      where: { organisationId: user.organisationId },
      update: { gpsRetentionDays: retentionDays },
      create: {
        organisationId: user.organisationId,
        gpsRetentionDays: retentionDays,
      },
    });
    void this.audit.record(user, {
      action: 'GPS_RETENTION_UPDATED',
      entityType: 'Organisation',
      entityId: user.organisationId,
      metadata: { retentionDays },
    });
    return this.get(user);
  }

  /**
   * Makes a new secret and returns it once. Only its hash is kept, so a lost
   * secret is replaced, never shown again. The old one stops working at once.
   */
  async rotateSecret(user: AuthUser) {
    const secret = randomBytes(32).toString('base64url');
    const setAt = new Date();
    await this.prisma.organisationSettings.upsert({
      where: { organisationId: user.organisationId },
      update: {
        gpsWebhookSecretHash: hashGatewaySecret(secret),
        gpsWebhookSecretSetAt: setAt,
      },
      create: {
        organisationId: user.organisationId,
        gpsWebhookSecretHash: hashGatewaySecret(secret),
        gpsWebhookSecretSetAt: setAt,
      },
    });
    void this.audit.record(user, {
      action: 'GPS_GATEWAY_SECRET_CREATED',
      entityType: 'Organisation',
      entityId: user.organisationId,
    });
    return { ...(await this.get(user)), secret };
  }

  async revokeSecret(user: AuthUser) {
    await this.prisma.organisationSettings.updateMany({
      where: { organisationId: user.organisationId },
      data: { gpsWebhookSecretHash: null, gpsWebhookSecretSetAt: null },
    });
    void this.audit.record(user, {
      action: 'GPS_GATEWAY_SECRET_REVOKED',
      entityType: 'Organisation',
      entityId: user.organisationId,
    });
    return this.get(user);
  }

  private gatewayUrl(slug: string) {
    const origin = this.config
      .get<string>('WEB_ORIGIN', 'http://localhost:5173')
      .split(',')[0]
      .trim()
      .replace(/\/+$/, '');
    return `${origin}/api/integrations/gps/flespi/workspaces/${slug}`;
  }
}
