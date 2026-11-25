import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Authenticator apps use 6 digits that change every 30 seconds (RFC 6238 defaults). */
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;

export function base32Encode(bytes: Buffer): string {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  }
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = '';
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 secret');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/** A new 160-bit secret in the base32 form authenticator apps expect. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(
    BigInt(Math.floor(now / 1000 / TOTP_PERIOD_SECONDS)),
  );
  const hmac = createHmac('sha1', base32Decode(secret))
    .update(counter)
    .digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
  return String(value).padStart(TOTP_DIGITS, '0');
}

/** Accepts the current code and the one either side of it, to allow for clock drift. */
export function verifyTotp(
  secret: string,
  code: string,
  now = Date.now(),
): boolean {
  const candidate = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(candidate)) return false;
  const step = TOTP_PERIOD_SECONDS * 1000;
  let matched = false;
  for (const drift of [-1, 0, 1]) {
    const expected = totpCode(secret, now + drift * step);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) {
      matched = true;
    }
  }
  return matched;
}

export function totpUri(input: {
  issuer: string;
  account: string;
  secret: string;
}): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

const BACKUP_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Ten single-use codes in the form "abcde-12345", the same shape Kleidi issues. */
export function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    let raw = '';
    for (let i = 0; i < 10; i += 1) {
      raw += BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)];
    }
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export function normaliseBackupCode(code: string): string {
  const raw = code.toLowerCase().replace(/[^a-z0-9]/g, '');
  return raw.length === 10 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw;
}
