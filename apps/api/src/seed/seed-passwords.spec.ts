import {
  isLocalDatabase,
  PUBLIC_SEED_PASSWORDS,
  resolveSeedPasswords,
} from './seed-passwords';

const LOCAL = 'postgresql://vip:vip@localhost:5432/vehicle_import';
const SERVER = 'postgresql://vip:secret@postgres:5432/vehicle_import';
const PRIVATE = {
  SEED_ADMIN_PASSWORD: 'private-admin-value',
  SEED_STAFF_PASSWORD: 'private-staff-value',
  SEED_CUSTOMER_PASSWORD: 'private-customer-value',
};

describe('isLocalDatabase', () => {
  it.each([
    LOCAL,
    'postgresql://vip:vip@127.0.0.1:5432/vehicle_import',
    'postgresql://vip:vip@[::1]:5432/vehicle_import',
  ])('accepts %s', (url) => {
    expect(isLocalDatabase(url)).toBe(true);
  });

  it.each([
    undefined,
    '',
    'not a url',
    SERVER,
    'postgresql://vip:vip@db.example.com/vehicle_import',
    'postgresql://vip:vip@localhost.example.com/vehicle_import',
    'postgresql://vip:vip@localhost/vehicle_import?host=db.example.com',
  ])('rejects %s', (url) => {
    expect(isLocalDatabase(url)).toBe(false);
  });
});

describe('resolveSeedPasswords', () => {
  it('uses the public passwords on a local development database', () => {
    expect(resolveSeedPasswords({ DATABASE_URL: LOCAL })).toEqual(
      PUBLIC_SEED_PASSWORDS,
    );
  });

  it.each([
    ['NODE_ENV is production', { NODE_ENV: 'production', DATABASE_URL: LOCAL }],
    ['the database is not local', { DATABASE_URL: SERVER }],
    ['there is no database address', {}],
  ])('needs private passwords when %s', (_case, env) => {
    expect(() => resolveSeedPasswords(env)).toThrow(
      'SEED_ADMIN_PASSWORD is not set.',
    );
    expect(resolveSeedPasswords({ ...env, ...PRIVATE })).toEqual({
      admin: 'private-admin-value',
      staff: 'private-staff-value',
      customer: 'private-customer-value',
    });
  });

  it('refuses a public password taken from the environment', () => {
    expect(() =>
      resolveSeedPasswords({
        DATABASE_URL: SERVER,
        ...PRIVATE,
        SEED_STAFF_PASSWORD: PUBLIC_SEED_PASSWORDS.staff,
      }),
    ).toThrow('SEED_STAFF_PASSWORD is one of the public demo passwords.');
  });

  it('refuses a short password', () => {
    expect(() =>
      resolveSeedPasswords({
        DATABASE_URL: SERVER,
        ...PRIVATE,
        SEED_CUSTOMER_PASSWORD: 'short',
      }),
    ).toThrow('SEED_CUSTOMER_PASSWORD must be at least 12 characters.');
  });
});
