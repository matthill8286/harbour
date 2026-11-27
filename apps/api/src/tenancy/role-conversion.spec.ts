import { RoleConversionService } from './role-conversion.service';

describe('converting retired roles at startup', () => {
  it('turns Owners into Admins and Viewers into Staff, for members and pending invites', async () => {
    const prisma = {
      organisationMembership: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 2 })
          .mockResolvedValueOnce({ count: 1 }),
      },
      staffInvite: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    const total = await new RoleConversionService(prisma as never).convert();
    expect(total).toBe(3);
    expect(prisma.organisationMembership.updateMany).toHaveBeenCalledWith({
      where: { role: 'OWNER' },
      data: { role: 'ADMIN' },
    });
    expect(prisma.organisationMembership.updateMany).toHaveBeenCalledWith({
      where: { role: 'VIEWER' },
      data: { role: 'STAFF' },
    });
    expect(prisma.staffInvite.updateMany).toHaveBeenCalledWith({
      where: { role: 'VIEWER' },
      data: { role: 'STAFF' },
    });
  });
});
