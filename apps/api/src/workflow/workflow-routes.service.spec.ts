import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { WorkflowRoutesService } from './workflow-routes.service';

const owner = {
  id: 'user-1',
  organisationId: 'org-1',
  role: 'ADMIN',
} as AuthUser;

function routeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'route-1',
    organisationId: 'org-1',
    name: 'Japan → Cyprus',
    shortLabel: 'JP → CY',
    originCountry: 'JP',
    destinationCountry: 'CY',
    isDefault: false,
    active: true,
    systemKey: null,
    sortOrder: 1,
    stages: [
      {
        id: 'stage-japan',
        name: 'Japan',
        customerName: 'Japan',
        customerVisible: true,
        sortOrder: 0,
        statuses: [
          { code: 'BOOKED', label: 'Booked', sortOrder: 0 },
          { code: 'AT_PORT', label: 'At the port', sortOrder: 1 },
        ],
      },
      {
        id: 'stage-sea',
        name: 'Sea freight',
        customerName: 'Sea freight',
        customerVisible: true,
        sortOrder: 1,
        statuses: [{ code: 'AT_SEA', label: 'At sea', sortOrder: 0 }],
      },
    ],
    ...overrides,
  };
}

function setup(
  route = routeRow(),
  jobs: Array<{ id: string; status: string }> = [],
) {
  const tx = {
    routeStage: { update: jest.fn(), create: jest.fn() },
    routeStatus: {
      deleteMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };
  const prisma = {
    route: {
      findFirst: jest.fn().mockResolvedValue(route),
      findMany: jest.fn().mockResolvedValue([route]),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    routeStage: { delete: jest.fn(), update: jest.fn() },
    importJob: {
      findMany: jest.fn().mockResolvedValue(jobs),
      groupBy: jest.fn().mockResolvedValue([
        { routeId: 'route-1', status: 'BOOKED', _count: { _all: 2 } },
        { routeId: 'route-1', status: 'AT_SEA', _count: { _all: 1 } },
        { routeId: 'other', status: 'BOOKED', _count: { _all: 5 } },
      ]),
      updateMany: jest.fn(),
    },
    jobStatusHistory: {
      createMany: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([
        {
          importJobId: 'job-1',
          _max: { createdAt: new Date(Date.now() + 60_000) },
        },
      ]),
    },
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (t: typeof tx) => unknown)(tx)
        : Promise.all(arg as unknown[]),
    ),
  };
  const audit = { record: jest.fn() };
  const service = new WorkflowRoutesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, prisma, tx, audit };
}

describe('editing a route', () => {
  it('renames a status in place, so jobs at it keep their code', async () => {
    const { service, tx } = setup();
    await service.saveStage(owner, 'route-1', 'stage-japan', {
      name: 'Japan',
      customerVisible: true,
      statuses: [
        { code: 'BOOKED', label: 'Booked with the agent' },
        { code: 'AT_PORT', label: 'At the port' },
      ],
    });
    expect(tx.routeStatus.update).toHaveBeenCalledWith({
      where: { routeId_code: { routeId: 'route-1', code: 'BOOKED' } },
      data: { label: 'Booked with the agent', sortOrder: 0 },
    });
    expect(tx.routeStatus.deleteMany).not.toHaveBeenCalled();
  });

  it('gives a new status its own code', async () => {
    const { service, tx } = setup();
    await service.saveStage(owner, 'route-1', 'stage-japan', {
      name: 'Japan',
      customerVisible: true,
      statuses: [
        { code: 'BOOKED', label: 'Booked' },
        { code: 'AT_PORT', label: 'At the port' },
        { label: 'Loaded' },
      ],
    });
    expect(tx.routeStatus.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: 'LOADED',
        stageId: 'stage-japan',
        sortOrder: 2,
      }),
    });
  });

  it('refuses to drop a status that jobs are at', async () => {
    const { service, prisma } = setup(routeRow(), [
      { id: 'job-1', status: 'AT_PORT' },
    ]);
    await expect(
      service.saveStage(owner, 'route-1', 'stage-japan', {
        name: 'Japan',
        customerVisible: true,
        statuses: [{ code: 'BOOKED', label: 'Booked' }],
      }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.importJob.findMany).toHaveBeenCalled();
  });

  it('refuses to take a status from another stage', async () => {
    const { service } = setup();
    await expect(
      service.saveStage(owner, 'route-1', 'stage-japan', {
        name: 'Japan',
        customerVisible: true,
        statuses: [{ code: 'AT_SEA', label: 'At sea' }],
      }),
    ).rejects.toThrow(/another stage/);
  });

  it('asks where jobs go before removing a stage they are in', async () => {
    const { service } = setup(routeRow(), [{ id: 'job-1', status: 'AT_SEA' }]);
    await expect(
      service.removeStage(owner, 'route-1', 'stage-sea'),
    ).rejects.toThrow(/1 job is in Sea freight/);
    await expect(
      service.removeStage(owner, 'route-1', 'stage-sea', 'AT_SEA'),
    ).rejects.toThrow(BadRequestException);
  });

  it('moves the jobs and records why when a stage is removed', async () => {
    const { service, prisma } = setup(routeRow(), [
      { id: 'job-1', status: 'AT_SEA' },
    ]);
    await service.removeStage(owner, 'route-1', 'stage-sea', 'AT_PORT');
    expect(prisma.importJob.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['job-1'] } },
      data: { status: 'AT_PORT' },
    });
    expect(prisma.jobStatusHistory.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          importJobId: 'job-1',
          fromStatus: 'AT_SEA',
          toStatus: 'AT_PORT',
          note: 'Moved to At the port because the Sea freight stage was removed',
        }),
      ],
    });
    const [entry] = prisma.jobStatusHistory.createMany.mock.calls[0][0].data;
    // After the job's latest entry, which was stamped a minute ahead.
    expect(entry.createdAt.getTime()).toBeGreaterThan(Date.now() + 60_000);
    expect(prisma.routeStage.delete).toHaveBeenCalledWith({
      where: { id: 'stage-sea' },
    });
  });

  it('keeps the default route switched on', async () => {
    const { service } = setup(routeRow({ isDefault: true }));
    await expect(
      service.update(owner, 'route-1', { active: false }),
    ).rejects.toThrow(/default route cannot be switched off/);
  });

  it('will not switch on a draft with an empty stage', async () => {
    const draft = routeRow({ active: false });
    draft.stages[1].statuses = [];
    const { service } = setup(draft);
    await expect(
      service.update(owner, 'route-1', { active: true }),
    ).rejects.toThrow(/Add a status to Sea freight/);
  });

  it('makes one route the default and clears the old one', async () => {
    const { service, prisma } = setup();
    await service.update(owner, 'route-1', { isDefault: true });
    expect(prisma.route.updateMany).toHaveBeenCalledWith({
      where: { organisationId: 'org-1', isDefault: true },
      data: { isDefault: false },
    });
    expect(prisma.route.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'route-1' },
        data: expect.objectContaining({ isDefault: true }),
      }),
    );
  });

  it('counts open jobs per route and per status', async () => {
    const { service } = setup(routeRow({ isDefault: true }));
    jest.spyOn(service, 'ensureDefault').mockResolvedValue({} as never);
    const [route] = await service.list(owner);
    expect(route.activeJobs).toBe(3);
    expect(route.jobsByStatus).toEqual({ BOOKED: 2, AT_SEA: 1 });
  });
});
