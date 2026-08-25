import { Injectable } from '@nestjs/common';
import {
  getJobStage,
  JOB_STAGE_LABELS,
  type JobStage,
  type JobStatus,
} from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async get(user: AuthUser) {
    const [jobs, overdueTasks, upcomingDeliveries, offlineTrackers] =
      await Promise.all([
        this.prisma.importJob.findMany({
          where: { organisationId: user.organisationId },
          select: {
            id: true,
            reference: true,
            status: true,
            expectedDeliveryDate: true,
            customer: { select: { firstName: true, lastName: true } },
            vehicle: {
              select: { make: true, model: true, ukRegistration: true },
            },
          },
        }),
        this.prisma.task.findMany({
          where: {
            organisationId: user.organisationId,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
            dueDate: { lt: new Date() },
          },
          include: {
            importJob: { select: { id: true, reference: true } },
          },
          orderBy: { dueDate: 'asc' },
          take: 8,
        }),
        this.prisma.importJob.findMany({
          where: {
            organisationId: user.organisationId,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
            expectedDeliveryDate: {
              gte: new Date(),
              lte: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            },
          },
          include: {
            customer: true,
            vehicle: true,
          },
          orderBy: { expectedDeliveryDate: 'asc' },
          take: 8,
        }),
        this.prisma.tracker.findMany({
          where: {
            organisationId: user.organisationId,
            OR: [
              { status: 'OFFLINE' },
              {
                status: 'ASSIGNED',
                lastSeenAt: { lt: new Date(Date.now() - 4 * 60 * 60 * 1000) },
              },
            ],
          },
          include: {
            assignments: {
              where: { removedAt: null },
              include: { importJob: { select: { id: true, reference: true } } },
              take: 1,
            },
          },
        }),
      ]);

    const byStage = jobs.reduce(
      (acc, job) => {
        const stage = getJobStage(job.status as JobStatus);
        acc[stage] = (acc[stage] ?? 0) + 1;
        return acc;
      },
      {} as Record<JobStage, number>,
    );

    return {
      activeJobs: jobs.filter(
        (job) => !['COMPLETED', 'CANCELLED'].includes(job.status),
      ).length,
      byStage: Object.entries(JOB_STAGE_LABELS).map(([stage, label]) => ({
        stage,
        label,
        count: byStage[stage as JobStage] ?? 0,
      })),
      overdueTasks,
      upcomingDeliveries,
      offlineTrackers,
    };
  }
}
