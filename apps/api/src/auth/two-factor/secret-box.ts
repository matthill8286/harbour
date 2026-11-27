import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'crypto';

const VERSION = 'v1';

/**
 * Encrypts two-factor secrets and backup codes at rest with AES-256-GCM.
 * The key is derived from a server secret, so a database dump alone cannot produce codes.
 */
export class SecretBox {
  private readonly key: Buffer;
  private readonly readKeys: Buffer[];

  /** `previousSecrets` open older values, but never encrypt new ones. */
  constructor(serverSecret: string, previousSecrets: string[] = []) {
    if (!serverSecret) throw new Error('A server secret is required');
    this.key = deriveKey(serverSecret);
    this.readKeys = [this.key, ...previousSecrets.map(deriveKey)];
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv, tag, body].map(encode).join(':');
  }

  decrypt(payload: string): string {
    const [version, iv, tag, body] = payload.split(':');
    if (version !== VERSION || !iv || !tag || !body) {
      throw new Error('Unreadable two-factor secret');
    }
    let failure: unknown;
    for (const key of this.readKeys) {
      try {
        const decipher = createDecipheriv(
          'aes-256-gcm',
          key,
          Buffer.from(iv, 'base64url'),
        );
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([
          decipher.update(Buffer.from(body, 'base64url')),
          decipher.final(),
        ]).toString('utf8');
      } catch (error) {
        failure = error;
      }
    }
    throw failure;
  }
}

function deriveKey(secret: string) {
  return Buffer.from(hkdfSync('sha256', secret, '', 'harbour-two-factor', 32));
}

function encode(part: string | Buffer): string {
  return typeof part === 'string' ? part : part.toString('base64url');
}
