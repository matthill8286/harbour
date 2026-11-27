import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { ImportJobsService } from './import-jobs.service';

type Row = Record<string, unknown>;

/** Matches the equality and `in` filters these queries use, so a missing filter lets the wrong row through. */
const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, wanted]) =>
    typeof wanted === 'object' && wanted !== null && 'in' in wanted
      ? (wanted.in as unknown[]).includes(row[key])
      : row[key] === wanted,
  );

const member = (
  organisationId: string,
  userId: string,
  role: string,
  status = 'ACTIVE',
) => ({
  id: `${organisationId}:${userId}`,
  organisationId,
  userId,
  role,
  status,
});

/** Two workspaces, each with a job, a task and its own people. */
function setup() {
  const jobs: Row[] = [
    { id: 'job-a', organisationId: 'org-a', status: 'NEW' },
    { id: 'job-a2', organisationId: 'org-a', status: 'NEW' },
    { id: 'job-b', organisationId: 'org-b', status: 'NEW' },
  ];
  const tasks: Row[] = [
    { id: 'task-a', organisationId: 'org-a', importJobId: 'job-a' },
    { id: 'task-b', organisationId: 'org-b', importJobId: 'job-b' },
  ];
  const memberships: Row[] = [
    member('org-a', 'admin-a', 'ADMIN'),
    member('org-a', 'staff-a', 'STAFF'),
    member('org-a', 'customer-a', 'CUSTOMER'),
    member('org-a', 'invited-a', 'STAFF', 'INVITED'),
    member('org-a', 'disabled-a', 'STAFF', 'DISABLED'),
    member('org-b', 'staff-b', 'STAFF'),
  ];
  const find = (rows: Row[]) =>
    jest.fn(({ where }: { where: Row }) =>
      Promise.resolve(rows.find((row) => matches(row, where)) ?? null),
    );
  const detail = { costs: [], charges: [] };
  const prisma = {
    importJob: {
      findFirst: jest.fn(({ where }: { where: Row }) => {
        const job = jobs.find((row) => matches(row, where));
        return Promise.resolve(job ? { ...job, ...detail } : null);
      }),
    },
    organisationMembership: { findFirst: find(memberships) },
    task: {
      findFirst: find(tasks),
      create: jest.fn(({ data }: { data: Row }) => Promise.resolve(data)),
      update: jest.fn(({ where, data }: { where: Row; data: Row }) =>
        Promise.resolve({
          ...tasks.find((row) => matches(row, where)),
          ...data,
        }),
      ),
    },
  };
  const none = {} as never;
  const tracking = { alignToStatus: jest.fn() };
  const service = new ImportJobsService(
    prisma as never,
    none,
    none,
    none,
    tracking as never,
    none,
    none,
    none,
    none,
  );
  return { service, prisma };
}

const userA = { id: 'admin-a', organisationId: 'org-a' } as AuthUser;

describe('updating a task across two workspaces', () => {
  it('updates a task on the job and workspace it belongs to', async () => {
    const { service, prisma } = setup();
    await service.updateTask(userA, 'job-a', 'task-a', { title: 'Book ferry' });
    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'task-a',
          importJobId: 'job-a',
          organisationId: 'org-a',
        },
      }),
    );
  });

  it("will not touch another workspace's task through your own job", async () => {
    const { service, prisma } = setup();
    await expect(
      service.updateTask(userA, 'job-a', 'task-b', { title: 'Taken' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('will not touch a task through a different job', async () => {
    const { service, prisma } = setup();
    await expect(
      service.updateTask(userA, 'job-a2', 'task-a', { title: 'Moved' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it("will not accept another workspace's job", async () => {
    const { service, prisma } = setup();
    await expect(
      service.updateTask(userA, 'job-b', 'task-b', { title: 'Taken' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });
});

describe('assigning a task', () => {
  const refused = [
    ['staff of another workspace', 'staff-b'],
    ['a customer', 'customer-a'],
    ['someone who has not accepted their invite', 'invited-a'],
    ['a disabled member', 'disabled-a'],
    ['an unknown user', 'nobody'],
    ['an empty ID', ''],
  ];

  it.each(refused)('refuses %s on create and update', async (_who, id) => {
    const { service, prisma } = setup();
    await expect(
      service.addTask(userA, 'job-a', { title: 'Call', assignedToId: id }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateTask(userA, 'job-a', 'task-a', { assignedToId: id }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it.each(['admin-a', 'staff-a'])('accepts active staff: %s', async (id) => {
    const { service, prisma } = setup();
    await service.addTask(userA, 'job-a', {
      title: 'Call',
      assignedToId: id,
    });
    await service.updateTask(userA, 'job-a', 'task-a', { assignedToId: id });
    expect(prisma.task.create).toHaveBeenCalled();
    expect(prisma.task.update).toHaveBeenCalled();
  });

  it('lets a task be unassigned, or left as it is', async () => {
    const { service, prisma } = setup();
    await service.addTask(userA, 'job-a', { title: 'Call' });
    await service.updateTask(userA, 'job-a', 'task-a', { assignedToId: null });
    await service.updateTask(userA, 'job-a', 'task-a', { title: 'Call back' });
    expect(prisma.organisationMembership.findFirst).not.toHaveBeenCalled();
    expect(prisma.task.update).toHaveBeenCalledTimes(2);
  });
});
