import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';
import { jwtSecret, twoFactorKeys } from './secrets';
import { SecretBox } from './two-factor/secret-box';
import { TwoFactorService } from './two-factor/two-factor.service';

const config = (values: Record<string, string>) =>
  ({
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  }) as ConfigService;

const production = {
  NODE_ENV: 'production',
  JWT_SECRET: 'private-session-secret',
  TWO_FACTOR_ENCRYPTION_KEY: 'private-two-factor-key',
};

describe('server secrets', () => {
  it.each([
    ['JWT_SECRET', ''],
    ['JWT_SECRET', 'replace-with-a-long-random-secret'],
    ['TWO_FACTOR_ENCRYPTION_KEY', ''],
    ['TWO_FACTOR_ENCRYPTION_KEY', 'replace-with-a-long-random-secret'],
  ])('refuses to start in production when %s is "%s"', (name, value) => {
    const broken = config({ ...production, [name]: value });
    expect(
      () =>
        new TwoFactorService(
          {} as PrismaService,
          {} as JwtService,
          {} as AuditService,
          broken,
        ),
    ).toThrow(name);
  });

  it('refuses to check sessions in production without JWT_SECRET', () => {
    const broken = config({ NODE_ENV: 'production' });
    expect(() => new JwtStrategy(broken, {} as PrismaService)).toThrow(
      'JWT_SECRET',
    );
    expect(() => jwtSecret(broken)).toThrow('JWT_SECRET');
  });

  it('starts in development with nothing set', () => {
    expect(() => twoFactorKeys(config({}))).not.toThrow();
  });

  it('still reads what JWT_SECRET encrypted before the two-factor key existed', () => {
    const before = twoFactorKeys(config({ JWT_SECRET: production.JWT_SECRET }));
    const sealed = new SecretBox(before.current, before.previous).encrypt(
      'JBSWY3DPEHPK3PXP',
    );

    const after = twoFactorKeys(config(production));
    const box = new SecretBox(after.current, after.previous);

    expect(box.decrypt(sealed)).toBe('JBSWY3DPEHPK3PXP');
    // New values use the two-factor key alone.
    expect(() =>
      new SecretBox(production.JWT_SECRET).decrypt(box.encrypt('new')),
    ).toThrow();
  });
});
