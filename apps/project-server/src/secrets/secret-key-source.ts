import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigurationError } from '../errors.js';

const KEY_BYTES = 32;

/**
 * Where the key that seals project variables comes from (D-07): `RUNFLUX_SECRET_KEY` (32 bytes in
 * base64) when set, otherwise `<RUNFLUX_HOME or the user's home>/.runflux/secret.key`, generated on
 * first use and readable only by its owner. The key never enters the database.
 */
export class SecretKeySource {
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env;
  }

  /** The path of the key file, for messages and backups. */
  get file(): string {
    return path.join(this.env.RUNFLUX_HOME || os.homedir(), '.runflux', 'secret.key');
  }

  load(): Buffer {
    const configured = this.env.RUNFLUX_SECRET_KEY;
    if (configured) return decodeKey(configured, 'RUNFLUX_SECRET_KEY', 'RUNFLUX_SECRET_KEY must hold 32 bytes in base64');
    const file = this.file;
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      // `wx` fails if another process created the file meanwhile; that key is then read below.
      try {
        fs.writeFileSync(file, `${randomBytes(KEY_BYTES).toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    return decodeKey(fs.readFileSync(file, 'utf8').trim(), 'RUNFLUX_SECRET_KEY', `${file} must hold 32 bytes in base64; restore it from a backup or set RUNFLUX_SECRET_KEY`);
  }
}

function decodeKey(text: string, variable: string, message: string): Buffer {
  const key = Buffer.from(text.trim(), 'base64');
  if (key.length !== KEY_BYTES) throw new ConfigurationError(variable, message);
  return key;
}
