import {
  base32Decode,
  base32Encode,
  generateBackupCodes,
  generateTotpSecret,
  normaliseBackupCode,
  totpCode,
  totpUri,
  verifyTotp,
} from './totp';

// RFC 6238 appendix B uses the ASCII secret "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('matches the RFC 6238 SHA-1 test vectors (last six digits)', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totpCode(RFC_SECRET, 59_000)).toBe('287082');
    expect(totpCode(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(totpCode(RFC_SECRET, 2_000_000_000_000)).toBe('279037');
  });

  it('round-trips base32', () => {
    const bytes = Buffer.from('harbour two-factor');
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it('generates a 160-bit base32 secret', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
  });

  it('accepts the current code and one step of clock drift either way', () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now), now)).toBe(true);
    expect(
      verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now - 30_000), now),
    ).toBe(true);
    expect(
      verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now + 30_000), now),
    ).toBe(true);
    expect(
      verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now - 90_000), now),
    ).toBe(false);
  });

  it('accepts a code typed with a space and rejects junk', () => {
    const now = 1_700_000_000_000;
    const code = totpCode(RFC_SECRET, now);
    expect(
      verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now),
    ).toBe(true);
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBe(false);
  });

  it('builds an otpauth URI that authenticator apps can scan', () => {
    const raw = totpUri({
      issuer: 'Harbour',
      account: 'alex@demo.local',
      secret: RFC_SECRET,
    });
    expect(raw.startsWith('otpauth://totp/Harbour%3Aalex%40demo.local?')).toBe(
      true,
    );
    const uri = new URL(raw);
    expect(uri.searchParams.get('secret')).toBe(RFC_SECRET);
    expect(uri.searchParams.get('issuer')).toBe('Harbour');
  });

  it('issues ten unique backup codes and normalises what users type', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
    expect(normaliseBackupCode(' ABCDE 12345 ')).toBe('abcde-12345');
    expect(normaliseBackupCode('abcde-12345')).toBe('abcde-12345');
  });
});

describe('the authenticator entry name', () => {
  it('writes spaces in the issuer as %20, so apps do not show a +', () => {
    const uri = totpUri({
      issuer: 'Harbour (localhost)',
      account: 'a@b.co',
      secret: 'ABC',
    });
    expect(uri).toContain('issuer=Harbour%20%28localhost%29');
    expect(decodeURIComponent(uri.split('issuer=')[1].split('&')[0])).toBe(
      'Harbour (localhost)',
    );
    expect(uri).not.toContain('+');
  });
});
