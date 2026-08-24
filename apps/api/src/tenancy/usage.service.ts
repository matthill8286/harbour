import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { monthStartUtc } from './tenant-keys';

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  incrementImportJobs(organisationId: string, at = new Date()) {
    const periodStart = monthStartUtc(at);
    return this.prisma.usageRecord.upsert({
      where: {
        organisationId_metric_periodStart: {
          organisationId,
          metric: 'IMPORT_JOBS',
          periodStart,
        },
      },
      update: { quantity: { increment: 1 } },
      create: {
        organisationId,
        metric: 'IMPORT_JOBS',
        periodStart,
        quantity: 1,
      },
    });
  }
}
