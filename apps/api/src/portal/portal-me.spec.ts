import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { PortalService } from './portal.service';

const customer = {
  id: 'user-9',
  organisationId: 'org-1',
  customerId: 'cust-1',
  role: 'CUSTOMER',
} as AuthUser;

function service() {
  const prisma = {
    customer: {
      update: jest.fn((args: { data: object }) => ({
        id: 'cust-1',
        ...args.data,
      })),
    },
    user: { update: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const audit = { record: jest.fn() };
  const portal = new PortalService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    audit as never,
  );
  return { portal, prisma, audit };
}

describe('a customer updating their own details', () => {
  it('saves the trimmed details, renames their sign-in and audits it', async () => {
    const { portal, prisma, audit } = service();
    const result = await portal.updateMe(customer, {
      firstName: ' John ',
      lastName: 'Smith ',
      phone: ' ',
      address: ' Limassol, Cyprus ',
    });
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cust-1' },
        data: {
          firstName: 'John',
          lastName: 'Smith',
          phone: null,
          address: 'Limassol, Cyprus',
        },
      }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-9' },
      data: { name: 'John Smith' },
    });
    expect(result).toMatchObject({ firstName: 'John' });
    expect(audit.record).toHaveBeenCalledWith(
      customer,
      expect.objectContaining({ action: 'CUSTOMER_UPDATED_OWN_DETAILS' }),
    );
  });

  it('refuses an account with no customer profile', async () => {
    const { portal } = service();
    await expect(
      portal.updateMe(
        { ...customer, customerId: null },
        { firstName: 'A', lastName: 'B' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
