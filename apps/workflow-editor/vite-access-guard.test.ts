// @vitest-environment node
//
// vite-platform.ts:19 resolves a path at MODULE LOAD time (new URL('../project-server/.env',
// import.meta.url)). Under jsdom, import.meta.url is an http:// URL and fileURLToPath throws
// "The URL must be of scheme file", so the module is only importable in the node
// environment. vite-platform.test.ts pins this with the same directive; the constraint is
// recorded here so the next person does not lose an hour to it.
import { describe, expect, it, vi } from 'vitest';
import { createAccessGuard } from './vite-platform';

// The three Vite plugins that mount the editor's dev-only endpoints had no test at all before
// this file. The guard they share is the thing that stands between an exposed dev server and
// anyone who can reach it, so it is pinned here directly rather than through a running Vite.

function request(headers: Record<string, string>): import('node:http').IncomingMessage {
  return { headers } as unknown as import('node:http').IncomingMessage;
}

const TOKEN = 'a'.repeat(32);

describe('createAccessGuard — no token configured', () => {
  const guard = createAccessGuard(undefined);

  it('authorises every request, because a local setup has nothing to check', () => {
    expect(guard.authorize(request({}))).toBe(true);
    expect(guard.authorize(request({ authorization: 'Bearer whatever' }))).toBe(true);
    expect(guard.authorize(request({ authorization: 'Basic nonsense' }))).toBe(true);
  });

  it('lets the request through without touching the response', () => {
    const next = vi.fn();
    const response = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
    guard.middleware(request({}), response as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(response.end).not.toHaveBeenCalled();
  });
});

describe('createAccessGuard — a token is configured', () => {
  const guard = createAccessGuard(TOKEN);

  it('authorises the exact token', () => {
    expect(guard.authorize(request({ authorization: `Bearer ${TOKEN}` }))).toBe(true);
  });

  it('refuses a missing header', () => {
    expect(guard.authorize(request({}))).toBe(false);
  });

  it('refuses a header that is not Bearer', () => {
    expect(guard.authorize(request({ authorization: `Basic ${TOKEN}` }))).toBe(false);
    expect(guard.authorize(request({ authorization: TOKEN }))).toBe(false);
    expect(guard.authorize(request({ authorization: `bearer ${TOKEN}` }))).toBe(false);
  });

  it('refuses a wrong token, a prefix of it, and an extension of it', () => {
    expect(guard.authorize(request({ authorization: `Bearer ${'a'.repeat(31)}` }))).toBe(false);
    expect(guard.authorize(request({ authorization: `Bearer ${TOKEN}a` }))).toBe(false);
    expect(guard.authorize(request({ authorization: 'Bearer ' }))).toBe(false);
  });

  it('answers 401 with the challenge header and the error body', () => {
    const next = vi.fn();
    const setHeader = vi.fn();
    const end = vi.fn();
    const response = { statusCode: 0, setHeader, end };
    guard.middleware(request({}), response as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(401);
    expect(setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(end).toHaveBeenCalledWith(JSON.stringify({ error: 'Authentication required' }));
  });

  it('does not call next when it refuses', () => {
    const next = vi.fn();
    guard.middleware(request({ authorization: 'Bearer wrong' }), { statusCode: 0, setHeader: vi.fn(), end: vi.fn() } as never, next);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('createAccessGuard — comparison properties', () => {
  const guard = createAccessGuard(TOKEN);

  // The comparison is done over SHA-256 digests with timingSafeEqual, so length does not leak.
  // These tests pin that a token of a different length is refused on the same footing as one of
  // the same length, which is what constant-time comparison is for.
  it('refuses a much shorter and a much longer token alike', () => {
    expect(guard.authorize(request({ authorization: 'Bearer a' }))).toBe(false);
    expect(guard.authorize(request({ authorization: `Bearer ${'a'.repeat(1000)}` }))).toBe(false);
  });

  it('is not fooled by the value appearing elsewhere in the header', () => {
    expect(guard.authorize(request({ authorization: `Bearer x ${TOKEN} y` }))).toBe(false);
    expect(guard.authorize(request({ authorization: `${TOKEN} Bearer` }))).toBe(false);
  });

  it('returns the same answer every time for the same input', () => {
    const header = { authorization: `Bearer ${TOKEN}` };
    const results = Array.from({ length: 5 }, () => guard.authorize(request(header)));
    expect(new Set(results).size).toBe(1);
  });
});