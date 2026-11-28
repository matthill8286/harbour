import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { providedSecret } from './flespi-webhook.guard';

export type WorkspaceGpsRequest = Request & { gpsOrganisationId?: string };

/** What is stored for a workspace's gateway secret. */
export function hashGatewaySecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Lets a workspace post positions from its own Flespi account, with its own
 * secret. The secret opens only that workspace: the platform secret is never
 * accepted here, and this one is never accepted on the platform route.
 * An unknown workspace and a wrong secret get the same answer.
 */
@Injectable()
export class WorkspaceGpsWebhookGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<WorkspaceGpsRequest>();
    const slug = String(request.params?.slug ?? '');
    const provided = providedSecret(request);
    const workspace = slug
      ? await this.prisma.organisation.findUnique({
          where: { slug },
          select: {
            id: true,
            status: true,
            settings: { select: { gpsWebhookSecretHash: true } },
          },
        })
      : null;
    const stored = workspace?.settings?.gpsWebhookSecretHash ?? '';
    const given = hashGatewaySecret(provided);
    const matches =
      provided.length > 0 &&
      stored.length === given.length &&
      timingSafeEqual(Buffer.from(stored), Buffer.from(given));
    if (!workspace || workspace.status !== 'ACTIVE' || !matches) {
      throw new UnauthorizedException('Invalid GPS webhook secret');
    }
    request.gpsOrganisationId = workspace.id;
    return true;
  }
}
