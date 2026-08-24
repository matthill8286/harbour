import { Injectable } from '@nestjs/common';
import type { FeatureFlag } from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(organisationId: string, flag: FeatureFlag): Promise<boolean> {
    const row = await this.prisma.organisationFeature.findUnique({
      where: { organisationId_flag: { organisationId, flag } },
    });
    return row?.enabled ?? false;
  }
}
