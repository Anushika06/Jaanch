import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** Unguessable public id for an investigation (128 bits), e.g. "J4fT9…". */
export function newInvestigationId(): string {
  return `J${randomBytes(16).toString('base64url')}`;
}

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Keyed hashing and encryption derived from APP_SECRET. Phone numbers and IP addresses are
 * never stored raw: rate limits and sessions use HMACs; the one value that must be kept briefly
 * (where to send a WhatsApp reply) is encrypted with AES-256-GCM inside the job payload.
 */
export class Secrets {
  private readonly hmacKey: Buffer;
  private readonly encKey: Buffer;

  constructor(appSecret: string) {
    this.hmacKey = Buffer.from(hkdfSync('sha256', appSecret, 'jaanch', 'hmac-v1', 32));
    this.encKey = Buffer.from(hkdfSync('sha256', appSecret, 'jaanch', 'aes-gcm-v1', 32));
  }

  hmac(value: string): string {
    return createHmac('sha256', this.hmacKey).update(value).digest('base64url');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `v1.${iv.toString('base64url')}.${ct.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
  }

  decrypt(token: string): string {
    const [v, iv, ct, tag] = token.split('.');
    if (v !== 'v1' || !iv || !ct || !tag) throw new Error('malformed ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  encryptJson(value: unknown): string {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson<T>(token: string): T {
    return JSON.parse(this.decrypt(token)) as T;
  }
}
