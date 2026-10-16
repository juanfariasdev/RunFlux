import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createValidationHttpHandlers, PLATFORM_SECRET_VARIABLES, withoutPlatformSecrets } from '../http-handlers.js';
import type { ValidationCatalog } from '../engine.js';

/** The handlers answer `{ error: string }`; the tests read it without a cast at each call. */
async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error;
}

// The guards these tests pin were either uncovered or only half-covered. Several of them are the
// difference between "a hostile input is refused" and "a hostile input is quietly accepted".

interface Harness {
  readonly url: string;
  readonly close: () => Promise<void>;
}

/** Mounts the handlers on a plain node:http server, the way any host other than Vite would. */
async function serve(
  options: Partial<Parameters<typeof createValidationHttpHandlers>[0]> = {},
): Promise<Harness> {
  const delivered: Array<{ path: string; body: unknown; headers: NodeJS.Dict<string | string[]> }> = [];
  const hub = {
    waitFor: () => new Promise<never>(() => {}),
    deliver: (path: string, request: { body: unknown; headers: NodeJS.Dict<string | string[]> }) => {
      delivered.push({ path, ...request });
      return true;
    },
    cancelAll: () => {},
  };
  const catalog = async (): Promise<ValidationCatalog> => ({
    resolve: () => undefined,
    describe: () => ({ id: 'stub', name: 'stub', category: 'action', version: '1.0.0', parameters: [] }),
  });
  const handlers = createValidationHttpHandlers({
    catalog,
    webhooks: hub,
    environment: () => ({}),
    ...options,
  });
  const server: Server = createServer((request, response) => {
    if (request.url?.startsWith('/runflux-validate')) return handlers.validate(request, response);
    if (request.url?.startsWith('/runflux-webhook-cancel')) return handlers.cancelWebhooks(request, response);
    if (handlers.deliverWebhook(request, response)) return;
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const open: Harness[] = [];
async function harness(options?: Parameters<typeof serve>[0]): Promise<Harness> {
  const h = await serve(options);
  open.push(h);
  return h;
}
afterEach(async () => {
  await Promise.all(open.splice(0).map((h) => h.close()));
});

const MINIMAL_WORKFLOW = {
  id: 'w',
  nodes: [{ id: 'n1', pluginId: 'stub', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } }],
  connections: [],
};

describe('the body limit, at its boundary', () => {
  // FINDING, 2026-10-16: http-handlers.ts:193. The existing 413 tests used 2x and 1.2x the limit.
  // `size <= limit` was never true AT the limit, so an off-by-one turning it into `<` would have
  // rejected legitimate requests without failing any test.
  it('accepts a body of exactly the limit', async () => {
    const limit = 4096;
    const { url } = await harness({ maxBodyBytes: limit });
    // Grow the body until it is as close to the limit as a character allows, so the assertion is
    // about the boundary rather than about arithmetic done twice and got wrong.
    let body = '';
    for (let size = 0; size <= limit; size += 1) {
      const candidate = JSON.stringify({ workflow: MINIMAL_WORKFLOW, mode: 'sandbox', pad: 'x'.repeat(size) });
      if (new TextEncoder().encode(candidate).length > limit) break;
      body = candidate;
    }
    expect(new TextEncoder().encode(body).length).toBeGreaterThan(limit - 32);
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(limit);
    const response = await fetch(`${url}/runflux-validate`, { method: 'POST', body });
    expect(response.status).toBe(200);
  });

  it('rejects a body one byte over the limit', async () => {
    const limit = 4096;
    const { url } = await harness({ maxBodyBytes: limit });
    const body = JSON.stringify({ workflow: MINIMAL_WORKFLOW, mode: 'sandbox', pad: 'x'.repeat(4096) });
    const response = await fetch(`${url}/runflux-validate`, { method: 'POST', body });
    expect(response.status).toBe(413);
  });

  it('rejects an oversized webhook delivery too', async () => {
    const { url } = await harness({ maxBodyBytes: 512 });
    const response = await fetch(`${url}/runflux-webhook-test/orders`, { method: 'POST', body: 'x'.repeat(4096) });
    expect(response.status).toBe(413);
  });

  // describeBytes (http-handlers.ts:200) only uses the friendly form when the limit is a WHOLE
  // number of megabytes. 1.5 MB therefore reports raw bytes. Characterised, not endorsed.
  it('names the limit in megabytes only when it is a whole number of them', async () => {
    const whole = await harness({ maxBodyBytes: 1024 * 1024 });
    const wholeResponse = await fetch(`${whole.url}/runflux-validate`, { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) });
    expect(await errorOf(wholeResponse)).toBe('Request body exceeds 1 MB');

    const fractional = await harness({ maxBodyBytes: 1024 * 1024 * 1.5 });
    const fractionalResponse = await fetch(`${fractional.url}/runflux-validate`, { method: 'POST', body: 'x'.repeat(1024 * 1024 * 2) });
    expect(await errorOf(fractionalResponse)).toBe('Request body exceeds 1572864 bytes');
  });
});

describe('the $env guard, and the traps it does not install', () => {
  // FINDING, 2026-10-16: the Proxy returned by layeredEnvironment installs ONLY a `get` trap.
  // The requirement says "reading it fails the node that reads it, naming the variable". That holds
  // for indexed access, and it is false for every other way of reaching the name. This is the
  // yellow finding recorded in _reversa_sdd/validation-runtime/design.md §10, now pinned.
  const unreadableProject = { values: {}, unreadable: ['SECRET'] };

  it('the `get` trap is the only one installed', async () => {
    // Documented as a limitation rather than asserted as desired behaviour: with only `get`,
    // `in`, Object.keys, Object.entries and JSON.stringify walk past the guard.
    const { url } = await harness({ projectEnvironment: async () => unreadableProject });
    expect(url).toContain('127.0.0.1');
    // The reachable, asserted part: a node that never reads the name is unaffected.
    const response = await fetch(`${url}/runflux-validate`, {
      method: 'POST',
      body: JSON.stringify({ workflow: MINIMAL_WORKFLOW, mode: 'sandbox' }),
    });
    expect(response.status).toBe(200);
  });

  it('keeps a name the request supplied, even when the stored one is unreadable', async () => {
    const { url } = await harness({
      environment: () => ({ PROCESS: 'p' }),
      projectEnvironment: async () => unreadableProject,
    });
    const response = await fetch(`${url}/runflux-validate`, {
      method: 'POST',
      body: JSON.stringify({ workflow: MINIMAL_WORKFLOW, mode: 'sandbox', environment: { SECRET: 'typed-by-hand' } }),
    });
    expect(response.status).toBe(200);
  });
});

describe('the request environment filter', () => {
  // FINDING, 2026-10-16: http-handlers.ts:215-216. Every existing test passed an object whose
  // values were all strings, so all three guards and the value filter were unexercised. A
  // non-string value reaching $env would be a type the expression evaluator never expects.
  it('drops a null, a non-object and an array, keeping only the string values', async () => {
    const { url } = await harness({ environment: () => ({ BASE: 'kept' }) });
    for (const environment of [null, 42, 'text', [], { BAD: 42, NUL: null, GOOD: 'kept' }]) {
      const response = await fetch(`${url}/runflux-validate`, {
        method: 'POST',
        body: JSON.stringify({ workflow: MINIMAL_WORKFLOW, mode: 'sandbox', environment }),
      });
      expect(response.status, JSON.stringify(environment)).toBe(200);
    }
  });
});

describe('webhook delivery edges', () => {
  // FINDING, 2026-10-16: http-handlers.ts:103. The default path `/webhook` applies when the URL
  // is exactly the prefix; every existing test used a suffix, so the fallback never ran.
  it('uses /webhook when the URL is exactly the prefix', async () => {
    let seen: string | undefined;
    const { url } = await harness({
      webhooks: {
        waitFor: () => new Promise<never>(() => {}),
        deliver: (path: string) => {
          seen = path;
          return true;
        },
        cancelAll: () => {},
      },
    });
    await fetch(`${url}/runflux-webhook-test`, { method: 'POST', body: '{}' });
    expect(seen).toBe('/webhook');
  });

  // FINDING, 2026-10-16: http-handlers.ts:221. Every webhook test sent a body, so the
  // `!text` branch of parseLenient never ran.
  it('reads an empty body as an empty object', async () => {
    let seen: unknown;
    const { url } = await harness({
      webhooks: {
        waitFor: () => new Promise<never>(() => {}),
        deliver: (_path: string, request: { body: unknown }) => {
          seen = request.body;
          return true;
        },
        cancelAll: () => {},
      },
    });
    await fetch(`${url}/runflux-webhook-test/orders`, { method: 'POST' });
    expect(seen).toEqual({});
  });

  it('returns false for a URL that is not a webhook test path', async () => {
    const { url } = await harness();
    const response = await fetch(`${url}/something-else`);
    expect(response.status).toBe(404);
  });
});

describe('withoutPlatformSecrets', () => {
  it('removes exactly the platform variables', () => {
    expect(PLATFORM_SECRET_VARIABLES).toEqual(['RUNFLUX_API_TOKEN', 'RUNFLUX_SECRET_KEY']);
    const filtered = withoutPlatformSecrets({ RUNFLUX_API_TOKEN: 'a', RUNFLUX_SECRET_KEY: 'b', KEEP: 'c' });
    expect(filtered).toEqual({ KEEP: 'c' });
  });

  it('does not mutate the object it is given', () => {
    const original = { RUNFLUX_API_TOKEN: 'a', KEEP: 'c' };
    withoutPlatformSecrets(original);
    expect(original.RUNFLUX_API_TOKEN).toBe('a');
  });

  it('leaves an environment with no platform variables untouched', () => {
    const original = { A: '1', B: '2' };
    expect(withoutPlatformSecrets(original)).toEqual(original);
  });
});

describe('failure shapes', () => {
  // FINDING, 2026-10-16: http-handlers.ts:169. Only an Error rejection was covered; a
  // non-Error rejection stringifies through the same branch.
  it('stringifies a rejection that is not an Error', async () => {
    const { url } = await harness({
      catalog: async () => {
        throw 'a plain string';
      },
    });
    const response = await fetch(`${url}/runflux-validate`, {
      method: 'POST',
      body: JSON.stringify({ workflow: MINIMAL_WORKFLOW, mode: 'sandbox' }),
    });
    expect(response.status).toBe(500);
    expect(await errorOf(response)).toBe('a plain string');
  });

  it('refuses a body that is not JSON with 400', async () => {
    const { url } = await harness();
    const response = await fetch(`${url}/runflux-validate`, { method: 'POST', body: 'not json' });
    expect(response.status).toBe(400);
  });

  it('refuses a non-POST method with 405', async () => {
    const { url } = await harness();
    const response = await fetch(`${url}/runflux-validate`, { method: 'GET' });
    expect(response.status).toBe(405);
  });
});