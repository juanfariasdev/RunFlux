// @vitest-environment node
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectServerEnvironmentClient } from './project-server-environment-client.ts';
import { assertSafeExposure, createAccessGuard, isExposedHost, readPlatformSettings } from './vite-platform.ts';

const TOKEN = 'a-token-that-is-long-enough-for-the-server';

/** The editor's dev server settings, guard and value client (feature 015, RN-14, RF-19, RF-20, D-13). */
describe('readPlatformSettings', () => {
  it('reads only the token and the port from the project server .env, and the shell wins', () => {
    const file = 'DATABASE_URL="file:./dev.db"\nPORT=4001\nRUNFLUX_API_TOKEN=from-file\nOTHER=x\n';
    expect(readPlatformSettings({}, file)).toEqual({ apiToken: 'from-file', projectServerUrl: 'http://127.0.0.1:4001' });
    expect(readPlatformSettings({ RUNFLUX_API_TOKEN: 'from-shell', PORT: '5001' }, file)).toEqual({ apiToken: 'from-shell', projectServerUrl: 'http://127.0.0.1:5001' });
    expect(readPlatformSettings({ RUNFLUX_PROJECT_SERVER_URL: 'http://127.0.0.1:9000/' }, file).projectServerUrl).toBe('http://127.0.0.1:9000');
  });

  it('defaults to port 3001 without a token, and treats an empty token as none', () => {
    expect(readPlatformSettings({})).toEqual({ projectServerUrl: 'http://127.0.0.1:3001' });
    expect(readPlatformSettings({ RUNFLUX_API_TOKEN: '' }, 'RUNFLUX_API_TOKEN=\n')).toEqual({ projectServerUrl: 'http://127.0.0.1:3001' });
  });
});

describe('exposure', () => {
  it('knows when the dev server listens beyond loopback', () => {
    for (const host of [true, '0.0.0.0', '::', '192.168.1.10']) expect(isExposedHost(host), String(host)).toBe(true);
    for (const host of [undefined, false, 'localhost', '127.0.0.1', '::1']) expect(isExposedHost(host), String(host)).toBe(false);
  });

  it('refuses to expose the dev server without a token', () => {
    expect(() => assertSafeExposure(true, undefined)).toThrow('RUNFLUX_API_TOKEN');
    expect(() => assertSafeExposure('0.0.0.0', TOKEN)).not.toThrow();
    expect(() => assertSafeExposure(undefined, undefined)).not.toThrow();
  });
});

describe('createAccessGuard', () => {
  const request = (authorization?: string) => ({ headers: authorization ? { authorization } : {} }) as IncomingMessage;
  const response = () => {
    const sent = { status: 0, body: '', headers: {} as Record<string, string> };
    const res = {
      set statusCode(value: number) { sent.status = value; },
      setHeader: (name: string, value: string) => { sent.headers[name.toLowerCase()] = value; },
      end: (body: string) => { sent.body = body; },
    } as unknown as ServerResponse;
    return { res, sent };
  };

  it('lets everything through without a token', () => {
    const guard = createAccessGuard(undefined);
    expect(guard.authorize(request())).toBe(true);
    const next = vi.fn();
    guard.middleware(request(), response().res, next);
    expect(next).toHaveBeenCalled();
  });

  it('answers 401 without the right bearer token, and passes with it', () => {
    const guard = createAccessGuard(TOKEN);
    for (const header of [undefined, TOKEN, `Bearer ${TOKEN}x`]) {
      expect(guard.authorize(request(header)), String(header)).toBe(false);
      const { res, sent } = response();
      const next = vi.fn();
      guard.middleware(request(header), res, next);
      expect(next).not.toHaveBeenCalled();
      expect([sent.status, JSON.parse(sent.body), sent.headers['www-authenticate']]).toEqual([401, { error: 'Authentication required' }, 'Bearer']);
    }
    const next = vi.fn();
    guard.middleware(request(`Bearer ${TOKEN}`), response().res, next);
    expect(next).toHaveBeenCalled();
    expect(guard.authorize(request(`Bearer ${TOKEN}`))).toBe(true);
  });
});

describe('ProjectServerEnvironmentClient', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    }));
  });

  async function projectServer(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  const signal = () => new AbortController().signal;

  it('fetches the values of a project with the token', async () => {
    const seen: Array<[string | undefined, string | undefined]> = [];
    const url = await projectServer((request, response) => {
      seen.push([request.url, request.headers.authorization]);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ values: { DB_URL: 'x' }, unreadable: ['OLD'] }));
    });
    await expect(new ProjectServerEnvironmentClient(url, TOKEN).environmentOf('p 1', signal())).resolves.toEqual({ values: { DB_URL: 'x' }, unreadable: ['OLD'] });
    expect(seen).toEqual([['/internal/projects/p%201/environment', `Bearer ${TOKEN}`]]);
  });

  it('sends no header without a token', async () => {
    let authorization: string | undefined = 'unset';
    const url = await projectServer((request, response) => {
      authorization = request.headers.authorization;
      response.end('{"values":{}}');
    });
    await new ProjectServerEnvironmentClient(url).environmentOf('p1', signal());
    expect(authorization).toBeUndefined();
  });

  it('explains each failure', async () => {
    const statuses = [401, 403, 404, 500];
    const expected = [
      'The project server refused to give the variables (401)',
      'The project server refused to give the variables (403)',
      'Project p1 not found',
      'The project server answered 500',
    ];
    for (const [index, status] of statuses.entries()) {
      const url = await projectServer((_request, response) => { response.statusCode = status; response.end('{}'); });
      await expect(new ProjectServerEnvironmentClient(url).environmentOf('p1', signal())).rejects.toThrow(expected[index]);
    }
  });

  it('says so when the project server is not running', async () => {
    const url = await projectServer(() => {});
    await new Promise((resolve) => servers.pop()!.close(resolve));
    await expect(new ProjectServerEnvironmentClient(url).environmentOf('p1', signal())).rejects.toThrow(`Project server is not running on ${url}`);
  });

  it('gives up after its timeout', async () => {
    const url = await projectServer(() => {});
    await expect(new ProjectServerEnvironmentClient(url, undefined, 50).environmentOf('p1', signal())).rejects.toThrow('The project server did not answer in time');
  });

  it('stops when the test run is cancelled', async () => {
    const url = await projectServer(() => {});
    const controller = new AbortController();
    const pending = new ProjectServerEnvironmentClient(url).environmentOf('p1', controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});
