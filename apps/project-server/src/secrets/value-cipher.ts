import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Seals and opens the values of project variables. `context` is bound to the sealed text, so a
 * value copied to another project or variable does not open (D-06).
 */
export interface ValueCipher {
  seal(plain: string, context: string): string;
  /** @throws UnreadableValueError when the text was changed, sealed with another key or for another context. */
  open(sealed: string, context: string): string;
}

/** A sealed value that cannot be opened with the current key. */
export class UnreadableValueError extends Error {
  constructor(message = 'The value cannot be decrypted with the current key') {
    super(message);
    this.name = 'UnreadableValueError';
  }
}

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM with a random IV per value: `v1.<iv>.<tag>.<data>`, each part in base64url. */
export class AesGcmValueCipher implements ValueCipher {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('An AES-256 key has 32 bytes');
    this.key = key;
  }

  seal(plain: string, context: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), data].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.');
  }

  open(sealed: string, context: string): string {
    const [version, iv, tag, data, ...rest] = sealed.split('.');
    if (version !== VERSION || rest.length > 0 || iv === undefined || tag === undefined || data === undefined) throw new UnreadableValueError('The value was not sealed by this version of RunFlux');
    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64url'), { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new UnreadableValueError();
    }
  }
}
