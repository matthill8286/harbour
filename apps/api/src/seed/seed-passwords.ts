/**
 * The demo passwords below are public: they are in this repository. The seed may
 * only set them on a developer's own database. Anywhere else, the passwords come
 * from the environment.
 */
export const PUBLIC_SEED_PASSWORDS = {
  admin: 'ChangeMe!Admin1',
  staff: 'ChangeMe!Staff1',
  customer: 'ChangeMe!Customer1',
} as const;

export const SEED_PASSWORD_VARIABLES = {
  admin: 'SEED_ADMIN_PASSWORD',
  staff: 'SEED_STAFF_PASSWORD',
  customer: 'SEED_CUSTOMER_PASSWORD',
} as const;

const MIN_PRIVATE_PASSWORD_LENGTH = 12;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export type SeedAccount = keyof typeof PUBLIC_SEED_PASSWORDS;

export type SeedPasswords = Record<SeedAccount, string>;

/** True only for a database on this machine. A compose service name is not. */
export function isLocalDatabase(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  try {
    const url = new URL(databaseUrl);
    // Postgres lets ?host= override the host in the address.
    return LOCAL_HOSTS.has(url.searchParams.get('host') ?? url.hostname);
  } catch {
    return false;
  }
}

export function publicSeedPasswordsAllowed(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV !== 'production' && isLocalDatabase(env.DATABASE_URL);
}

export function resolveSeedPasswords(env: NodeJS.ProcessEnv): SeedPasswords {
  const publicAllowed = publicSeedPasswordsAllowed(env);
  const problems: string[] = [];
  const resolve = (account: SeedAccount): string => {
    const variable = SEED_PASSWORD_VARIABLES[account];
    const value = env[variable] ?? '';
    if (publicAllowed) {
      return value || PUBLIC_SEED_PASSWORDS[account];
    }
    if (!value) {
      problems.push(`${variable} is not set.`);
    } else if (value.toLowerCase().startsWith('changeme')) {
      problems.push(`${variable} is one of the public demo passwords.`);
    } else if (value.length < MIN_PRIVATE_PASSWORD_LENGTH) {
      problems.push(
        `${variable} must be at least ${MIN_PRIVATE_PASSWORD_LENGTH} characters.`,
      );
    }
    return value;
  };
  const passwords = {
    admin: resolve('admin'),
    staff: resolve('staff'),
    customer: resolve('customer'),
  };
  if (problems.length > 0) {
    throw new Error(
      [
        'The seed will not set the public demo passwords here, because NODE_ENV is production or the database is not local.',
        'Set a private password for each account. Nothing was written.',
        ...problems,
      ].join('\n'),
    );
  }
  return passwords;
}
