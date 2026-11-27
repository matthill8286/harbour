import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { RETIRED_ROLES } from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Converts the retired roles still stored in a database: Owner becomes Admin
 * and Viewer becomes Staff, for memberships and for invites not yet accepted.
 * It runs at every start and does nothing once there is nothing to convert.
 * The schema keeps the old values until every database has been converted.
 */
@Injectable()
export class RoleConversionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RoleConversionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      await this.convert();
    } catch (error) {
      this.logger.error('Could not convert retired roles', error as Error);
    }
  }

  async convert() {
    let total = 0;
    for (const [from, to] of Object.entries(RETIRED_ROLES)) {
      const role = from as keyof typeof RETIRED_ROLES;
      const [members, invites] = await this.prisma.$transaction([
        this.prisma.organisationMembership.updateMany({
          where: { role },
          data: { role: to },
        }),
        this.prisma.staffInvite.updateMany({
          where: { role },
          data: { role: to },
        }),
      ]);
      total += members.count + invites.count;
    }
    if (total) this.logger.log(`Converted ${total} retired roles`);
    return total;
  }
}
