import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../errors.js';
import { SecretKeySource } from '../secret-key-source.js';
import { AesGcmValueCipher, UnreadableValueError } from '../value-cipher.js';

describe('AesGcmValueCipher', () => {
  const cipher = new AesGcmValueCipher(randomBytes(32));

  it('opens what it sealed, and seals the same text differently each time', () => {
    const first = cipher.seal('postgres://u:p@h/db', 'p1:DB_URL');
    const second = cipher.seal('postgres://u:p@h/db', 'p1:DB_URL');
    expect(first).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain('postgres');
    expect(cipher.open(first, 'p1:DB_URL')).toBe('postgres://u:p@h/db');
  });

  it('refuses another key, a changed byte, another context and an unknown version', () => {
    const sealed = cipher.seal('secret', 'p1:API_KEY');
    const [version, iv, tag, data] = sealed.split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 1;
    const attempts = [
      () => new AesGcmValueCipher(randomBytes(32)).open(sealed, 'p1:API_KEY'),
      () => cipher.open([version, iv, tag, flipped.toString('base64url')].join('.'), 'p1:API_KEY'),
      () => cipher.open(sealed, 'p2:API_KEY'),
      () => cipher.open(sealed, 'p1:OTHER'),
      () => cipher.open(['v9', iv, tag, data].join('.'), 'p1:API_KEY'),
      () => cipher.open('not sealed', 'p1:API_KEY'),
    ];
    for (const attempt of attempts) expect(attempt).toThrow(UnreadableValueError);
  });
});

describe('SecretKeySource', () => {
  const homes: string[] = [];
  const home = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runflux-home-'));
    homes.push(directory);
    return directory;
  };

  afterEach(() => {
    for (const directory of homes.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
  });

  it('uses RUNFLUX_SECRET_KEY when it is set', () => {
    const key = randomBytes(32);
    const directory = home();
    expect(new SecretKeySource({ RUNFLUX_SECRET_KEY: key.toString('base64'), RUNFLUX_HOME: directory }).load()).toEqual(key);
    expect(fs.existsSync(path.join(directory, '.runflux'))).toBe(false);
  });

  it('refuses a RUNFLUX_SECRET_KEY that is not 32 bytes', () => {
    const load = () => new SecretKeySource({ RUNFLUX_SECRET_KEY: randomBytes(16).toString('base64') }).load();
    expect(load).toThrow(ConfigurationError);
    expect(load).toThrow('RUNFLUX_SECRET_KEY');
  });

  it('generates a key file readable only by its owner, and reuses it', () => {
    const directory = home();
    const first = new SecretKeySource({ RUNFLUX_HOME: directory }).load();
    const file = path.join(directory, '.runflux', 'secret.key');
    expect(first).toHaveLength(32);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    expect(new SecretKeySource({ RUNFLUX_HOME: directory }).load()).toEqual(first);
  });

  it('refuses a key file that does not hold 32 bytes', () => {
    const directory = home();
    fs.mkdirSync(path.join(directory, '.runflux'), { mode: 0o700 });
    fs.writeFileSync(path.join(directory, '.runflux', 'secret.key'), 'short', { mode: 0o600 });
    expect(() => new SecretKeySource({ RUNFLUX_HOME: directory }).load()).toThrow(ConfigurationError);
  });
});
