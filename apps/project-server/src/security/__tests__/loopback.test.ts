import { describe, expect, it } from 'vitest';
import { isLoopbackAddress, isLoopbackHost } from '../loopback.js';

// These two functions answer different questions — "which address am I configured to bind to"
// and "which address is this connection coming from" — so they are not expected to be identical.
// What is expected is that both normalise the same way. They do not, and the difference is pinned
// here so a change to one without the other is visible in a diff.
describe('isLoopbackHost — the configured bind address', () => {
  it('accepts the loopback range and its spellings', () => {
    for (const host of ['127.0.0.1', '127.0.0.53', '127.1.2.3', 'localhost', 'LOCALHOST', '::1', '  127.0.0.1  ', '  localhost  ']) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it('refuses anything that is not loopback', () => {
    for (const host of ['0.0.0.0', '10.0.0.1', '192.168.1.1', 'example.com', '128.0.0.1', '', ' ']) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });

  it('treats 127.x as loopback without accepting 128 or 126', () => {
    expect(isLoopbackHost('126.0.0.1')).toBe(false);
    expect(isLoopbackHost('1270.0.0.1')).toBe(false);
  });
});

describe('isLoopbackAddress — the connection remote address', () => {
  it('accepts the loopback range and IPv4-mapped IPv6', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '::FFFF:127.0.0.1']) {
      expect(isLoopbackAddress(address), address).toBe(true);
    }
  });

  it('refuses a missing or empty remote address', () => {
    expect(isLoopbackAddress(undefined)).toBe(false);
    expect(isLoopbackAddress('')).toBe(false);
  });

  it('refuses a non-loopback address', () => {
    for (const address of ['0.0.0.0', '10.0.0.1', '192.168.1.1', '::ffff:10.0.0.1']) {
      expect(isLoopbackAddress(address), address).toBe(false);
    }
  });

  // FINDING, 2026-10-16: isLoopbackHost trims (loopback.ts:5); isLoopbackAddress does not.
  // The asymmetry is benign in production — Node never emits a whitespace-padded
  // socket.remoteAddress — but the two functions are presented as a pair in
  // config.test.ts:61-63, so the difference is pinned rather than left implicit.
  it('does NOT trim, which is the documented difference from isLoopbackHost', () => {
    expect(isLoopbackHost(' 127.0.0.1 ')).toBe(true);
    expect(isLoopbackAddress(' 127.0.0.1 ')).toBe(false);
  });
});

describe('the pair, side by side', () => {
  // Only values that could be an answer to BOTH questions. `localhost` is a valid bind host but
  // never a remoteAddress, and `::ffff:127.0.0.1` is how an IPv4 loopback connection arrives but
  // is not an address you bind to. Those differences are correct, not asymmetries.
  it('agrees on every value that could be either', () => {
    for (const value of ['127.0.0.1', '127.0.0.53', '::1', '0.0.0.0', '10.0.0.1', '192.168.1.1']) {
      expect(isLoopbackHost(value), value).toBe(isLoopbackAddress(value));
    }
  });

  it('answers the two questions differently where they should', () => {
    // Binding to a name is fine; a connection can never come from one.
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackAddress('localhost')).toBe(false);
    // A connection arrives IPv4-mapped; you do not bind to the mapped form.
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackHost('::ffff:127.0.0.1')).toBe(false);
  });
});