import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(
    user: AuthUser,
    input: {
      action: string;
      entityType: string;
      entityId?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    try {
      await this.prisma.auditLog.create({
        data: {
          organisationId: user.organisationId,
          actorId: user.id,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (error) {
      this.logger.error('Failed to write audit log', error as Error);
    }
  }

  listForJob(user: AuthUser, importJobId: string) {
    return this.prisma.auditLog.findMany({
      where: {
        organisationId: user.organisationId,
        OR: [
          { entityType: 'ImportJob', entityId: importJobId },
          { metadata: { path: ['importJobId'], equals: importJobId } },
        ],
      },
      include: { actor: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });
  }
}
