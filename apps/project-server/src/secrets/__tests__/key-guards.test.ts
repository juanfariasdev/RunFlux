import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AesGcmValueCipher, UnreadableValueError, type ValueCipher } from '../value-cipher.js';

// The guards in value-cipher.ts are the difference between "a wrong key" and "tampered data"
// being told apart from "an OpenSSL error surfaced to the user". They are small, and until this
// file none of them was exercised.

describe('AesGcmValueCipher — the key guard', () => {
  // FINDING, 2026-10-16: value-cipher.ts:31 was uncovered. Every existing construction used
  // randomBytes(32), so the only defence against a wrong-sized key never fired.
  it('refuses a key that is not 32 bytes, with a message that names the cause', () => {
    for (const length of [0, 1, 16, 31, 33, 64]) {
      expect(() => new AesGcmValueCipher(Buffer.alloc(length)), `length ${length}`).toThrow('An AES-256 key has 32 bytes');
    }
  });

  it('accepts exactly 32 bytes', () => {
    expect(() => new AesGcmValueCipher(Buffer.alloc(32))).not.toThrow();
  });
});

describe('AesGcmValueCipher — the sealed format', () => {
  const cipher = new AesGcmValueCipher(Buffer.alloc(32, 3));

  it('produces v1.<iv>.<tag>.<data> with four parts', () => {
    const sealed = cipher.seal('a value', 'ctx');
    expect(sealed.split('.')).toHaveLength(4);
    expect(sealed.split('.')[0]).toBe('v1');
  });

  it('never repeats an IV, so the same plaintext seals differently each time', () => {
    const a = cipher.seal('same', 'ctx');
    const b = cipher.seal('same', 'ctx');
    expect(a).not.toBe(b);
    expect(cipher.open(a, 'ctx')).toBe('same');
    expect(cipher.open(b, 'ctx')).toBe('same');
  });

  it('round-trips an empty string and a multi-line string', () => {
    for (const plain of ['', 'one line', 'line 1\nline 2', '🔐 unicode ✓', 'x'.repeat(10_000)]) {
      expect(cipher.open(cipher.seal(plain, 'ctx'), 'ctx')).toBe(plain);
    }
  });
});

describe('AesGcmValueCipher.open — every way a sealed text can be wrong', () => {
  const cipher = new AesGcmValueCipher(Buffer.alloc(32, 3));
  const sealed = cipher.seal('the secret', 'ctx');
  const [version, iv, tag, data] = sealed.split('.');

  it('refuses a version it does not know', () => {
    expect(() => cipher.open(['v2', iv, tag, data].join('.'), 'ctx')).toThrow(UnreadableValueError);
  });

  // FINDING, 2026-10-16: value-cipher.ts:45 — the `rest.length > 0` guard against extra
  // segments had no test. Removing it does not break any other test in the repository.
  it('refuses extra segments appended to a valid sealed text', () => {
    expect(() => cipher.open(`${sealed}.extra`, 'ctx')).toThrow(UnreadableValueError);
    expect(() => cipher.open(`${sealed}.extra.more`, 'ctx')).toThrow(UnreadableValueError);
  });

  // FINDING, 2026-10-16: value-cipher.ts:47 and :49 — only the ciphertext was ever tampered
  // with. These are the two canonical GCM failure modes.
  it('refuses a tampered IV', () => {
    const flipped = Buffer.from(iv, 'base64url');
    flipped[0] ^= 0xff;
    expect(() => cipher.open([version, flipped.toString('base64url'), tag, data].join('.'), 'ctx')).toThrow(UnreadableValueError);
  });

  it('refuses a tampered authentication tag', () => {
    const flipped = Buffer.from(tag, 'base64url');
    flipped[0] ^= 0xff;
    expect(() => cipher.open([version, iv, flipped.toString('base64url'), data].join('.'), 'ctx')).toThrow(UnreadableValueError);
  });

  it('refuses a tampered ciphertext', () => {
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 0xff;
    expect(() => cipher.open([version, iv, tag, flipped.toString('base64url')].join('.'), 'ctx')).toThrow(UnreadableValueError);
  });

  it('refuses a truncated sealed text', () => {
    // FINDING, 2026-10-16: the `tag === undefined || data === undefined` guard was
    // unreachable from the existing tests, which only reached it via the version check.
    for (const truncated of ['v1', 'v1.abc', 'v1.abc.def', '', 'v1..']) {
      expect(() => cipher.open(truncated, 'ctx'), truncated).toThrow(UnreadableValueError);
    }
  });

  it('refuses a different context, which is what binds the value to its project and name', () => {
    expect(() => cipher.open(sealed, 'another-context')).toThrow(UnreadableValueError);
  });

  it('refuses a different key', () => {
    expect(() => new AesGcmValueCipher(Buffer.alloc(32, 9)).open(sealed, 'ctx')).toThrow(UnreadableValueError);
  });

  // The contract says a wrong key and tampering are indistinguishable to the caller.
  it('gives the same error class for tampering and for the wrong key', () => {
    const tampered = [version, iv, tag, Buffer.from(Buffer.from(data, 'base64url').map((b, i) => (i ? b : b ^ 0xff))).toString('base64url')].join('.');
    const tamperedError = captureError(() => cipher.open(tampered, 'ctx'));
    const wrongKeyError = captureError(() => new AesGcmValueCipher(Buffer.alloc(32, 9)).open(sealed, 'ctx'));
    expect(tamperedError).toBeInstanceOf(UnreadableValueError);
    expect(wrongKeyError).toBeInstanceOf(UnreadableValueError);
  });

  it('distinguishes a version it does not know with its own message', () => {
    expect(() => cipher.open(['v9', iv, tag, data].join('.'), 'ctx')).toThrow('not sealed by this version of RunFlux');
  });
});

function captureError(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

// The key file is written with flag 'wx' so two processes starting together cannot corrupt it,
// and EEXIST is swallowed so the loser reads the winner's key. That race branch was uncovered.

describe('SecretKeySource — the file race', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'runflux-key-race-'));
  });

  it('writes the key file readable only by its owner, inside a private directory', async () => {
    const { SecretKeySource } = await import('../secret-key-source.js');
    const source = new SecretKeySource({ RUNFLUX_HOME: home });
    const key = source.load();
    expect(key).toHaveLength(32);
    expect(statSync(join(home, '.runflux', 'secret.key')).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, '.runflux')).mode & 0o777).toBe(0o700);
  });

  it('is idempotent: a second load returns the same key and rewrites nothing', async () => {
    const { SecretKeySource } = await import('../secret-key-source.js');
    const first = new SecretKeySource({ RUNFLUX_HOME: home }).load().toString('base64');
    const before = statSync(join(home, '.runflux', 'secret.key')).mtimeMs;
    const second = new SecretKeySource({ RUNFLUX_HOME: home }).load().toString('base64');
    expect(second).toBe(first);
    expect(statSync(join(home, '.runflux', 'secret.key')).mtimeMs).toBe(before);
  });

  // FINDING, 2026-10-16: secret-key-source.ts:36 — the `if (code !== 'EEXIST') throw` line was
  // uncovered, so neither the tolerant path nor the re-throw of a real I/O failure was verified.
  it('tolerates the file appearing between the check and the write', async () => {
    vi.resetModules();
    const real = await import('node:fs');
    const winner = Buffer.alloc(32, 5).toString('base64');

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        default: {
          ...actual,
          // Report the file as absent, then create it before the exclusive write runs.
          existsSync: ((path: string) => {
            if (String(path).endsWith('secret.key')) return false;
            return actual.existsSync(path);
          }) as typeof actual.existsSync,
          writeFileSync: ((path: string, data: string, options: object) => {
            if (String(path).endsWith('secret.key')) {
              actual.mkdirSync(String(path).replace(/\/[^/]+$/, ''), { recursive: true });
              actual.writeFileSync(path, `${winner}\n`, options as never);
              const error = new Error('EEXIST: file already exists') as NodeJS.ErrnoException;
              error.code = 'EEXIST';
              throw error;
            }
            return actual.writeFileSync(path, data, options as never);
          }) as typeof actual.writeFileSync,
        },
      };
    });

    const { SecretKeySource } = await import('../secret-key-source.js');
    const key = new SecretKeySource({ RUNFLUX_HOME: home }).load();
    expect(key.toString('base64')).toBe(winner);
    expect(readFileSync(join(home, '.runflux', 'secret.key'), 'utf8').trim()).toBe(winner);

    vi.doUnmock('node:fs');
    vi.resetModules();
  });

  it('re-throws a write failure that is not a race', async () => {
    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        default: {
          ...actual,
          existsSync: (() => false) as typeof actual.existsSync,
          writeFileSync: (() => {
            const error = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
            error.code = 'EACCES';
            throw error;
          }) as unknown as typeof actual.writeFileSync,
        },
      };
    });

    const { SecretKeySource } = await import('../secret-key-source.js');
    // mkdirSync also goes through the mocked module, so let it succeed and fail only the write.
    expect(() => new SecretKeySource({ RUNFLUX_HOME: home }).load()).toThrow(/EACCES/);

    vi.doUnmock('node:fs');
    vi.resetModules();
  });
});

describe('SecretKeySource — where the key comes from', () => {
  it('refuses a configured key that is not 32 bytes, naming the variable', async () => {
    const { SecretKeySource } = await import('../secret-key-source.js');
    // The class is compared by shape, not by instanceof: earlier blocks in this file call
    // vi.resetModules(), so a dynamically imported errors.js is a different module instance
    // from the one imported statically at the top, and instanceof would be false.
    for (const bad of [Buffer.alloc(16).toString('base64'), Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64'), 'not base64 at all']) {
      let thrown: unknown;
      try {
        new SecretKeySource({ RUNFLUX_SECRET_KEY: bad }).load();
      } catch (error) {
        thrown = error;
      }
      expect(thrown, bad).toBeDefined();
      expect((thrown as Error).name, bad).toBe('ConfigurationError');
      expect((thrown as Error).message, bad).toContain('32 bytes');
      expect((thrown as { variable?: string }).variable, bad).toBe('RUNFLUX_SECRET_KEY');
    }
  });

  it('prefers the configured key over the file', async () => {
    const { SecretKeySource } = await import('../secret-key-source.js');
    const home = mkdtempSync(join(tmpdir(), 'runflux-key-both-'));
    mkdirSync(join(home, '.runflux'), { recursive: true });
    writeFileSync(join(home, '.runflux', 'secret.key'), `${Buffer.alloc(32, 1).toString('base64')}\n`);
    const key = new SecretKeySource({ RUNFLUX_SECRET_KEY: Buffer.alloc(32, 2).toString('base64'), RUNFLUX_HOME: home }).load();
    expect(key).toEqual(Buffer.alloc(32, 2));
  });

  // FINDING, 2026-10-16: `|| os.homedir()` was never reached, because every existing test set
  // RUNFLUX_HOME. An empty RUNFLUX_HOME is falsy and would fall through to the real home
  // directory, so the fallback is pinned with a mocked homedir rather than left untested.
  it('falls back to the user home when RUNFLUX_HOME is unset or empty', async () => {
    vi.resetModules();
    const home = mkdtempSync(join(tmpdir(), 'runflux-home-fallback-'));
    vi.doMock('node:os', async () => {
      const actual = await vi.importActual<typeof import('node:os')>('node:os');
      return { ...actual, default: { ...actual, homedir: () => home } };
    });
    const { SecretKeySource } = await import('../secret-key-source.js');
    expect(new SecretKeySource({ RUNFLUX_HOME: '' }).load()).toHaveLength(32);
    expect(new SecretKeySource({}).load()).toHaveLength(32);
    vi.doUnmock('node:os');
    vi.resetModules();
  });
});

describe('the two halves agree on the key', () => {
  it('a value sealed by the source opens with a cipher built from the same key', async () => {
    const { SecretKeySource } = await import('../secret-key-source.js');
    const home = mkdtempSync(join(tmpdir(), 'runflux-roundtrip-'));
    const cipherFromSource = new AesGcmValueCipher(new SecretKeySource({ RUNFLUX_HOME: home }).load());
    const standalone: ValueCipher = cipherFromSource;
    expect(standalone.open(standalone.seal('round trip', 'project:KEY'), 'project:KEY')).toBe('round trip');
  });
});