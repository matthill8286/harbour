import { SecretBox } from './secret-box';

describe('SecretBox', () => {
  const box = new SecretBox('test-server-secret');

  it('round-trips a value without storing it in plain text', () => {
    const sealed = box.encrypt('JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(box.decrypt(sealed)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('uses a fresh nonce each time', () => {
    expect(box.encrypt('same')).not.toBe(box.encrypt('same'));
  });

  it('refuses ciphertext sealed with another key', () => {
    const other = new SecretBox('another-server-secret');
    expect(() => other.decrypt(box.encrypt('secret'))).toThrow();
  });

  it('refuses tampered ciphertext', () => {
    const [version, iv, tag, body] = box.encrypt('secret').split(':');
    const flipped = Buffer.from(body, 'base64url');
    flipped[0] ^= 1;
    expect(() =>
      box.decrypt([version, iv, tag, flipped.toString('base64url')].join(':')),
    ).toThrow();
  });
});
