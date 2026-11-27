import type { ConfigService } from '@nestjs/config';

/** Used only outside production, so a fresh checkout runs without setup. */
const DEVELOPMENT_SECRET = 'replace-with-a-long-random-secret';

/** The setting, or in development the public default. Production must set it. */
function serverSecret(config: ConfigService, name: string): string | undefined {
  const value = config.get<string>(name);
  if (config.get<string>('NODE_ENV') !== 'production') return value;
  if (!value?.trim() || value === DEVELOPMENT_SECRET) {
    throw new Error(
      `${name} must be set to a private random value in production.`,
    );
  }
  return value;
}

/** Signs sessions and sign-in challenges. */
export function jwtSecret(config: ConfigService): string {
  return serverSecret(config, 'JWT_SECRET') || DEVELOPMENT_SECRET;
}

/**
 * Encrypts two-factor secrets and backup codes. `previous` can only read: before
 * TWO_FACTOR_ENCRYPTION_KEY was set, JWT_SECRET did this job, and what it
 * encrypted has to stay readable.
 */
export function twoFactorKeys(config: ConfigService): {
  current: string;
  previous: string[];
} {
  const session = jwtSecret(config);
  const current = serverSecret(config, 'TWO_FACTOR_ENCRYPTION_KEY') || session;
  return { current, previous: current === session ? [] : [session] };
}
