import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * A zca-js session as stored in `zalo_accounts.credentials` (encrypted). `cookie` is tough-cookie's
 * serialized jar (`SerializedCookie[]`); kept loose because zca-js owns its shape.
 */
export const ZaloCredentialsSchema = z.object({
  imei: z.string().min(1),
  userAgent: z.string().min(1),
  language: z.string().default('vi'),
  cookie: z.array(z.looseObject({ key: z.string(), value: z.string() })).min(1),
});
export type ZaloCredentials = z.infer<typeof ZaloCredentialsSchema>;

const VERSION = 'v1';
const IV_BYTES = 12;

/**
 * AES-256-GCM. Ciphertext format: `v1.<iv>.<tag>.<data>` (base64url parts). The owning vendor id is
 * bound as additional authenticated data, so a ciphertext copied onto another shop's row won't decrypt.
 */
export class CredentialsCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('ZALO_CREDENTIALS_KEY must be 32 bytes');
  }

  encrypt(credentials: ZaloCredentials, vendorId: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(vendorId, 'utf8'));
    const data = Buffer.concat([
      cipher.update(JSON.stringify(credentials), 'utf8'),
      cipher.final(),
    ]);
    return [VERSION, iv, cipher.getAuthTag(), data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  /** Throws on a wrong key or vendor, tampered ciphertext or an unexpected payload shape. */
  decrypt(ciphertext: string, vendorId: string): ZaloCredentials {
    const [version, iv, tag, data] = ciphertext.split('.');
    if (version !== VERSION || iv === undefined || tag === undefined || data === undefined) {
      throw new Error('Unrecognised credentials format');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(vendorId, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]);
    const parsed: unknown = JSON.parse(plain.toString('utf8'));
    return ZaloCredentialsSchema.parse(parsed);
  }
}
