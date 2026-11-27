import { BadRequestException, NotFoundException } from '@nestjs/common';
import { moneyLineProblem } from '@vip/shared';
import { ImportJobsService } from './import-jobs.service';

describe('moneyLineProblem', () => {
  it('accepts a line with a category and an amount, and no description', () => {
    expect(
      moneyLineProblem({ category: 'TRANSPORT', amount: 1200 }),
    ).toBeNull();
  });

  it('asks for a description when the category is Other', () => {
    expect(
      moneyLineProblem({ category: 'OTHER', description: '  ', amount: 50 }),
    ).toMatch(/description is needed/);
    expect(
      moneyLineProblem({
        category: 'OTHER',
        description: 'Ferry fuel surcharge',
        amount: 50,
      }),
    ).toBeNull();
  });

  it('refuses a negative or missing amount', () => {
    expect(moneyLineProblem({ category: 'TRANSPORT', amount: -1 })).toMatch(
      /0 or more/,
    );
    expect(
      moneyLineProblem({ category: 'TRANSPORT', amount: Number.NaN }),
    ).toMatch(/0 or more/);
  });
});

/** The service with only what the money methods touch: Prisma's cost table and the audit log. */
function serviceWith(cost: Record<string, unknown> | null) {
  const records: Array<{ action: string; metadata: Record<string, unknown> }> =
    [];
  const prisma = {
    cost: {
      findFirst: jest.fn().mockResolvedValue(cost),
      update: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...cost, ...data }),
        ),
      delete: jest.fn().mockResolvedValue(cost),
    },
  };
  const audit = {
    record: jest.fn(
      (
        _user: unknown,
        input: { action: string; metadata: Record<string, unknown> },
      ) => records.push(input),
    ),
  };
  const none = {} as never;
  const service = new ImportJobsService(
    prisma as never,
    none,
    audit as never,
    none,
    none,
    none,
    none,
    none,
    none,
  );
  return { service, prisma, records };
}

const user = { id: 'u1', organisationId: 'org1' } as never;
const line = {
  id: 'c1',
  importJobId: 'j1',
  organisationId: 'org1',
  category: 'TRANSPORT',
  description: 'UK to Bulgaria',
  amount: 1200,
};

describe('editing and deleting a cost line', () => {
  it('updates the line and writes the change, with what it was, to Activity', async () => {
    const { service, records } = serviceWith(line);
    const updated = await service.updateCost(user, 'j1', 'c1', {
      amount: 1350,
    });
    expect(updated.amount).toBe(1350);
    expect(records).toHaveLength(1);
    expect(records[0].action).toBe('MONEY_LINE_UPDATED');
    expect(records[0].metadata).toMatchObject({
      importJobId: 'j1',
      kind: 'cost',
      amount: 1350,
      before: { amount: 1200 },
    });
  });

  it('will not change a line to Other without a description', async () => {
    const { service, prisma } = serviceWith(line);
    await expect(
      service.updateCost(user, 'j1', 'c1', {
        category: 'OTHER',
        description: '',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.cost.update).not.toHaveBeenCalled();
  });

  it('only finds a line on the job and workspace it belongs to', async () => {
    const { service, prisma } = serviceWith(null);
    await expect(service.deleteCost(user, 'j2', 'c1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.cost.findFirst).toHaveBeenCalledWith({
      where: { id: 'c1', importJobId: 'j2', organisationId: 'org1' },
    });
    expect(prisma.cost.delete).not.toHaveBeenCalled();
  });

  it('deletes the line and writes it to Activity', async () => {
    const { service, records } = serviceWith(line);
    await expect(service.deleteCost(user, 'j1', 'c1')).resolves.toEqual({
      deleted: true,
    });
    expect(records[0]).toMatchObject({
      action: 'MONEY_LINE_DELETED',
      metadata: { kind: 'cost', description: 'UK to Bulgaria' },
    });
  });
});
