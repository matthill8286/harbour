import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verify } from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailTransport } from '../../integrations/email-transport';
import { hashInviteToken } from '../invite-token';
import { issuedBeforePasswordChange } from '../jwt.strategy';
import { PasswordResetService } from './password-reset.service';

type Reset = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

type User = {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  passwordChangedAt: Date | null;
};

function fakePrisma() {
  const users: User[] = [
    {
      id: 'user-1',
      email: 'staff@demo.local',
      name: 'Sam Staff',
      passwordHash: 'old-hash',
      passwordChangedAt: null,
    },
    {
      id: 'user-2',
      email: 'invited@demo.local',
      name: 'Invited',
      passwordHash: null,
      passwordChangedAt: null,
    },
  ];
  const resets: Reset[] = [];
  const matches = (
    reset: Reset,
    where: {
      id?: string;
      userId?: string;
      usedAt?: null;
      expiresAt?: { gt: Date };
      createdAt?: { gt: Date };
    },
  ) =>
    (where.id === undefined || reset.id === where.id) &&
    (where.userId === undefined || reset.userId === where.userId) &&
    (where.usedAt === undefined || reset.usedAt === null) &&
    (where.expiresAt === undefined || reset.expiresAt > where.expiresAt.gt) &&
    (where.createdAt === undefined || reset.createdAt > where.createdAt.gt);

  const prisma = {
    user: {
      findUnique: jest.fn(({ where }: { where: { email: string } }) =>
        Promise.resolve(users.find((u) => u.email === where.email) ?? null),
      ),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Partial<User> }) => {
          const user = users.find((u) => u.id === where.id)!;
          Object.assign(user, data);
          return Promise.resolve(user);
        },
      ),
    },
    passwordReset: {
      findFirst: jest.fn(
        ({ where }: { where: Parameters<typeof matches>[1] }) =>
          Promise.resolve(resets.find((r) => matches(r, where)) ?? null),
      ),
      findUnique: jest.fn(({ where }: { where: { tokenHash: string } }) => {
        const reset = resets.find((r) => r.tokenHash === where.tokenHash);
        return Promise.resolve(
          reset
            ? { ...reset, user: users.find((u) => u.id === reset.userId)! }
            : null,
        );
      }),
      create: jest.fn(
        ({ data }: { data: Omit<Reset, 'id' | 'usedAt' | 'createdAt'> }) => {
          const reset = {
            id: `reset-${resets.length + 1}`,
            usedAt: null,
            createdAt: new Date(),
            ...data,
          };
          resets.push(reset);
          return Promise.resolve(reset);
        },
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: Parameters<typeof matches>[1];
          data: Partial<Reset>;
        }) => {
          const hit = resets.filter((r) => matches(r, where));
          hit.forEach((r) => Object.assign(r, data));
          return Promise.resolve({ count: hit.length });
        },
      ),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    (work: Promise<unknown>[] | ((tx: unknown) => unknown)) =>
      typeof work === 'function'
        ? Promise.resolve(work(prisma))
        : Promise.all(work),
  );
  return { prisma, users, resets };
}

describe('PasswordResetService', () => {
  const config = {
    get: (_key: string, fallback?: string) =>
      fallback === 'http://localhost:5173' ? 'https://harbour.test/' : fallback,
  } as ConfigService;

  function setup() {
    const fake = fakePrisma();
    const email = { send: jest.fn().mockResolvedValue({ provider: 'log' }) };
    const service = new PasswordResetService(
      fake.prisma as unknown as PrismaService,
      email as unknown as EmailTransport,
      config,
    );
    return { ...fake, email, service };
  }

  function tokenFrom(email: { send: jest.Mock }) {
    const [message] = email.send.mock.calls.at(-1) as [{ text: string }];
    const match = /reset-password\/([A-Za-z0-9_-]+)/.exec(message.text);
    return match![1];
  }

  it('emails a one-hour link and stores only a hash of the token', async () => {
    const { service, email, resets } = setup();
    await service.request('  Staff@Demo.local ');
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'staff@demo.local' }),
    );
    const token = tokenFrom(email);
    expect(email.send.mock.calls[0][0].text).toContain(
      `https://harbour.test/reset-password/${token}`,
    );
    expect(resets).toHaveLength(1);
    expect(resets[0].tokenHash).toBe(hashInviteToken(token));
    expect(resets[0].tokenHash).not.toBe(token);
    const ttl = resets[0].expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(59 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it('says nothing about unknown or not-yet-activated accounts', async () => {
    const { service, email, resets } = setup();
    await expect(service.request('nobody@demo.local')).resolves.toBeUndefined();
    await expect(
      service.request('invited@demo.local'),
    ).resolves.toBeUndefined();
    expect(email.send).not.toHaveBeenCalled();
    expect(resets).toHaveLength(0);
  });

  it('sends at most one email a minute', async () => {
    const { service, email } = setup();
    await service.request('staff@demo.local');
    await service.request('staff@demo.local');
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it('keeps only the newest link working', async () => {
    const { service, email, resets } = setup();
    await service.request('staff@demo.local');
    const first = tokenFrom(email);
    resets[0].createdAt = new Date(Date.now() - 2 * 60 * 1000);
    await service.request('staff@demo.local');
    const second = tokenFrom(email);
    await expect(service.check(first)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.check(second)).resolves.toMatchObject({
      email: 'staff@demo.local',
    });
  });

  it('sets the new password once, and ends older sessions', async () => {
    const { service, email, users } = setup();
    await service.request('staff@demo.local');
    const token = tokenFrom(email);
    await service.reset(token, 'a-brand-new-password');
    const user = users[0];
    expect(await verify(user.passwordHash!, 'a-brand-new-password')).toBe(true);
    expect(user.passwordChangedAt).toBeInstanceOf(Date);
    await expect(
      service.reset(token, 'another-password!'),
    ).rejects.toBeInstanceOf(BadRequestException);
    const oldSession = Math.floor(Date.now() / 1000) - 60;
    expect(issuedBeforePasswordChange(oldSession, user.passwordChangedAt)).toBe(
      true,
    );
    expect(
      issuedBeforePasswordChange(
        Math.floor(Date.now() / 1000) + 1,
        user.passwordChangedAt,
      ),
    ).toBe(false);
    expect(issuedBeforePasswordChange(oldSession, null)).toBe(false);
  });

  it('rejects expired and unknown links', async () => {
    const { service, email, resets } = setup();
    await service.request('staff@demo.local');
    const token = tokenFrom(email);
    resets[0].expiresAt = new Date(Date.now() - 1);
    await expect(
      service.reset(token, 'a-brand-new-password'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.check('made-up')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('still answers the same when the email provider fails', async () => {
    const { service, email } = setup();
    email.send.mockRejectedValueOnce(new Error('provider down'));
    await expect(service.request('staff@demo.local')).resolves.toBeUndefined();
  });
});
