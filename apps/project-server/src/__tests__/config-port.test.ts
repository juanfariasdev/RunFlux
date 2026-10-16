import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';

// FINDING 2026-10-16, BUG: PORT is the only setting without validation.
//
// config.ts validates RUNFLUX_API_TOKEN (too short), RUNFLUX_BODY_LIMIT (not a size) and
// RUNFLUX_SECRET_KEY (wrong byte length) — all three raise ConfigurationError naming the variable,
// and index.ts turns that into a clean message plus exit 1. PORT has no such branch:
//
//   port: env.PORT ? parseInt(env.PORT, 10) : 3001
//
// Consequences measured on 2026-10-16:
//   PORT=abc   -> NaN  -> listen(NaN) throws ERR_SOCKET_BAD_PORT
//   PORT=80abc -> 80   -> a partial number is accepted as if it were valid
//
// ERR_SOCKET_BAD_PORT is not a ConfigurationError, so index.ts:14 re-throws it and the server dies
// with a raw stack trace instead of the one-line message the other three settings produce.
//
// The tests below CHARACTERISE the current behaviour. They assert what the code does, not what it
// should do, so they are green today. When PORT gains validation, they will fail — that failure is
// the intended signal, and each one says what to invert.

describe('PORT — the unvalidated setting (characterisation)', () => {
  it('reads a well-formed port', () => {
    expect(loadConfig({ PORT: '8080' }).port).toBe(8080);
  });

  it('defaults to 3001 when PORT is absent', () => {
    expect(loadConfig({}).port).toBe(3001);
  });

  it('defaults to 3001 when PORT is an empty string, because "" is falsy', () => {
    expect(loadConfig({ PORT: '' }).port).toBe(3001);
  });

  // BUG: NaN. Nothing rejects it, and NaN reaches listen().
  it('produces NaN for a non-numeric PORT instead of refusing it', () => {
    expect(loadConfig({ PORT: 'abc' }).port).toBeNaN();
  });

  // BUG: parseInt stops at the first non-digit, so a typo yields a plausible-looking port.
  it('silently accepts a partially numeric PORT', () => {
    expect(loadConfig({ PORT: '80abc' }).port).toBe(80);
    expect(loadConfig({ PORT: '3001x' }).port).toBe(3001);
    expect(loadConfig({ PORT: '0x1f' }).port).toBe(0);
  });

  // BUG: negative, zero and out-of-range values are all accepted.
  it('accepts ports that no server can bind', () => {
    expect(loadConfig({ PORT: '-1' }).port).toBe(-1);
    expect(loadConfig({ PORT: '0' }).port).toBe(0);
    expect(loadConfig({ PORT: '99999999' }).port).toBe(99999999);
  });

  it('accepts a fractional port by truncating it', () => {
    expect(loadConfig({ PORT: '3001.9' }).port).toBe(3001);
  });
});

describe('the other settings, for contrast (characterisation)', () => {
  // These three DO refuse, with ConfigurationError naming the variable. PORT is the outlier,
  // and the contrast is what makes the inconsistency visible.
  it('refuses an exposed host without a token', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0' })).toThrow(/HOST=0\.0\.0\.0 exposes/);
  });

  it('refuses a token under 32 characters', () => {
    expect(() => loadConfig({ RUNFLUX_API_TOKEN: 'a'.repeat(31) })).toThrow(/at least 32 characters/);
  });

  it('refuses a body limit that is not a size', () => {
    expect(() => loadConfig({ RUNFLUX_BODY_LIMIT: 'big' })).toThrow(/must be a size/);
  });
});

describe('RUNFLUX_OUTPUT_DIR — the other unexercised branch (characterisation)', () => {
  // config.test.ts:20 uses toEqual without outputDirectory, which proves only its ABSENCE.
  // The branch that resolves a path was never run.
  it('resolves a relative output directory to an absolute path', () => {
    const config = loadConfig({ RUNFLUX_OUTPUT_DIR: 'relative/backends' });
    expect(config.outputDirectory).toBeDefined();
    expect(config.outputDirectory).toMatch(/^\//);
    expect(config.outputDirectory?.endsWith('/relative/backends')).toBe(true);
  });

  it('leaves an absolute output directory resolved', () => {
    expect(loadConfig({ RUNFLUX_OUTPUT_DIR: '/tmp/backends' }).outputDirectory).toBe('/tmp/backends');
  });

  it('omits the key entirely when the variable is absent', () => {
    expect(loadConfig({})).not.toHaveProperty('outputDirectory');
  });
});