import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EditorClient, ExpressClient, LambdaClient, ServerProcessClient, type BackendClient } from '../support/backend-clients';
import { buildExample, loadExample, nodeIds, workflowOf, type ExampleProject } from '../support/examples';
import type { ExportedProject } from '../support/exported-project';
import { scenariosFor, verify, type Scenario } from '../support/scenarios';
import { UpstreamServer } from '../support/upstream';
import { editorRegistry } from '../support/workflows';

const API_KEY = 'items-test-key';
const KEY = { 'X-Api-Key': API_KEY };

const SCENARIOS: Scenario[] = [
  // GET
  {
    name: 'GET lists every item',
    request: { method: 'GET', path: '/items' },
    respondedBy: 'filter-catalog',
    result: { count: 3, filters: { category: null, limit: null } },
    check: ({ body }) => expect(body.nodeOutputs['filter-catalog'].items.map((item: { id: number }) => item.id)).toEqual([1, 2, 3]),
  },
  {
    name: 'GET filters by category and limits through the query string',
    request: { method: 'GET', path: '/items?category=hardware&limit=1' },
    respondedBy: 'filter-catalog',
    result: { count: 1, items: [{ id: 1, name: 'Keyboard' }], filters: { category: 'hardware', limit: 1 } },
  },
  {
    name: 'GET answers an empty list for an unknown category',
    request: { method: 'GET', path: '/items?category=garden' },
    respondedBy: 'filter-catalog',
    result: { count: 0, items: [] },
  },
  {
    name: 'GET reaches the same route with a trailing slash',
    request: { method: 'GET', path: '/items/' },
    respondedBy: 'filter-catalog',
    result: { count: 3 },
  },
  // POST
  {
    name: 'POST creates a valid item and logs it',
    request: { method: 'POST', path: '/items', body: { name: 'Monitor', price: 899.9 } },
    respondedBy: 'log-created',
    result: { status: 'created', name: 'Monitor', price: 899.9, slug: 'monitor' },
    ran: ['validate-item', 'item-created'],
    skipped: ['item-rejected'],
  },
  {
    name: 'POST trims the name and reads a price sent as text',
    request: { method: 'POST', path: '/items', body: { name: '  Standing Desk ', price: '150' } },
    respondedBy: 'log-created',
    result: { status: 'created', name: 'Standing Desk', price: 150, slug: 'standing-desk' },
  },
  {
    name: 'POST rejects an item without a name',
    request: { method: 'POST', path: '/items', body: { price: 10 } },
    respondedBy: 'item-rejected',
    result: { status: 'rejected', error: 'name and a positive price are required' },
    skipped: ['item-created', 'log-created'],
  },
  {
    name: 'POST rejects a price of zero',
    request: { method: 'POST', path: '/items', body: { name: 'Free lunch', price: 0 } },
    respondedBy: 'item-rejected',
    result: { status: 'rejected' },
  },
  // PUT
  {
    name: 'PUT replaces an item with the API key',
    request: { method: 'PUT', path: '/items?id=7', headers: KEY, body: { name: 'Mechanical keyboard', price: 129 } },
    respondedBy: 'item-replaced',
    result: { status: 'replaced', id: 7, name: 'Mechanical keyboard', price: 129 },
  },
  {
    name: 'PUT fails when the item id is not a number',
    request: { method: 'PUT', path: '/items?id=seven', headers: KEY, body: { name: 'x', price: 1 } },
    error: 'Field "id" must be a number',
  },
  { name: 'PUT refuses a request without the API key', request: { method: 'PUT', path: '/items?id=7', body: { name: 'x', price: 1 } }, status: 401 },
  { name: 'PUT refuses a wrong API key', request: { method: 'PUT', path: '/items?id=7', headers: { 'X-Api-Key': 'wrong' }, body: {} }, status: 401 },
  {
    name: 'PUT never passes the API key on to the workflow',
    request: { method: 'PUT', path: '/items?id=1', headers: KEY, body: { name: 'x', price: 1 } },
    httpOnly: true,
    check: ({ body }) => expect(body.nodeOutputs['replace-item']._headers['x-api-key']).toBeUndefined(),
  },
  // PATCH
  {
    name: 'PATCH applies the fields it receives',
    request: { method: 'PATCH', path: '/items?id=3', headers: KEY, body: { price: 10, name: 'Mouse v2' } },
    respondedBy: 'item-updated',
    result: { status: 'updated', id: 3, changes: { price: 10, name: 'Mouse v2' } },
    skipped: ['item-unchanged'],
  },
  {
    name: 'PATCH without fields answers unchanged',
    request: { method: 'PATCH', path: '/items?id=3', headers: KEY, body: {} },
    respondedBy: 'item-unchanged',
    result: { status: 'unchanged', reason: 'send at least one field to change' },
  },
  { name: 'PATCH requires the API key', request: { method: 'PATCH', path: '/items?id=3', body: { price: 1 } }, status: 401 },
  // DELETE
  {
    name: 'DELETE removes the item of the query id',
    request: { method: 'DELETE', path: '/items?id=9' },
    respondedBy: 'item-deleted',
    result: { status: 'deleted', id: 9 },
  },
  {
    name: 'DELETE without an id is rejected',
    request: { method: 'DELETE', path: '/items' },
    respondedBy: 'delete-rejected',
    result: { status: 'rejected', error: 'query parameter id is required' },
  },
  // ANY with a raw body
  {
    name: 'ANY /echo returns a raw text body sent with POST',
    request: { method: 'POST', path: '/echo', text: 'hello world' },
    respondedBy: 'echo-body',
    result: { received: 'hello world', length: 11, contentType: 'text/plain' },
  },
  {
    name: 'ANY /echo accepts PUT and keeps a JSON body as text',
    request: { method: 'PUT', path: '/echo', headers: { 'Content-Type': 'application/json' }, text: '{"a":1}' },
    respondedBy: 'echo-body',
    result: { received: '{"a":1}', length: 7, contentType: 'application/json' },
  },
  {
    name: 'ANY /echo answers DELETE without a body',
    request: { method: 'DELETE', path: '/echo' },
    respondedBy: 'echo-body',
    result: { received: '', length: 0, contentType: null },
  },
  // Outbound requests
  {
    name: 'POST /proxy forwards a PUT with its payload to the upstream API',
    request: { method: 'POST', path: '/proxy', body: { method: 'PUT', path: '/orders/1', payload: { qty: 2 } } },
    respondedBy: 'proxy-response',
    result: { upstreamStatus: 200, upstream: { method: 'PUT', path: '/orders/1', body: { qty: 2 }, forwardedBy: 'RunFlux' } },
  },
  {
    name: 'POST /proxy forwards a DELETE without a body',
    request: { method: 'POST', path: '/proxy', body: { method: 'DELETE', path: '/orders/1' } },
    respondedBy: 'proxy-response',
    result: { upstream: { method: 'DELETE', path: '/orders/1', body: null } },
  },
  {
    name: 'POST /proxy forwards a POST with a JSON body',
    request: { method: 'POST', path: '/proxy', body: { method: 'post', path: '/orders', payload: { items: [1, 2] } } },
    respondedBy: 'proxy-response',
    result: { upstream: { method: 'POST', path: '/orders', body: { items: [1, 2] } } },
  },
  {
    name: 'POST /proxy defaults to GET and keeps the query of the path',
    request: { method: 'POST', path: '/proxy', body: { path: '/search?q=runflux' } },
    respondedBy: 'proxy-response',
    result: { upstream: { method: 'GET', path: '/search', query: { q: 'runflux' }, body: null } },
  },
  {
    name: 'POST /proxy reports an upstream failure as a failed run',
    request: { method: 'POST', path: '/proxy', body: { path: '/fail' } },
    error: 'failed with status 503: upstream unavailable',
    skipped: ['proxy-response'],
  },
  {
    name: 'GET /upstream/health calls GET, POST, PUT and DELETE in parallel and merges the answers',
    request: { method: 'GET', path: '/upstream/health' },
    respondedBy: 'health-summary',
    result: {
      healthy: true,
      checks: [{ method: 'GET', status: 200 }, { method: 'POST', status: 200 }, { method: 'PUT', status: 200 }, { method: 'DELETE', status: 200 }],
    },
    ran: ['probe-get', 'probe-post', 'probe-put', 'probe-delete'],
  },
  // HTTP semantics of the exported backends
  { name: 'HEAD /items answers like GET', request: { method: 'HEAD', path: '/items' }, status: 200, httpOnly: true },
  { name: 'an unknown path answers 404', request: { method: 'GET', path: '/missing' }, status: 404, check: ({ body }) => expect(body).toEqual({ error: 'Not found' }) },
  { name: 'a method the path does not answer gets 405', request: { method: 'DELETE', path: '/upstream/health' }, status: 405 },
  { name: 'an invalid JSON body gets 400', request: { method: 'POST', path: '/items', headers: { 'Content-Type': 'application/json' }, text: '{broken' }, status: 400 },
  { name: 'no /api/execute bypass exists next to the webhooks', request: { method: 'POST', path: '/api/execute', body: {} }, status: 404 },
];

const HOSTS = ['editor', 'express', 'process', 'lambda'] as const;
type Host = (typeof HOSTS)[number];
const TITLES: Record<Host, string> = { editor: 'editor test run', express: 'exported Express app', process: 'exported server process', lambda: 'exported Lambda handler' };
const HTTP: Record<Host, boolean> = { editor: false, express: true, process: true, lambda: true };

let example: ExampleProject;
let upstream: UpstreamServer;
const projects: ExportedProject[] = [];
const clients = new Map<Host, BackendClient>();

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  upstream = await UpstreamServer.start();
  const env = { ITEMS_API_KEY: API_KEY, UPSTREAM_URL: upstream.url };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  example = await loadExample('http-api');
  const [local, aws] = await Promise.all([buildExample(example, 'local'), buildExample(example, 'aws')]);
  projects.push(local, aws);
  clients.set('editor', new EditorClient(workflowOf(example), await editorRegistry(), env));
  clients.set('express', await ExpressClient.create(local));
  clients.set('process', await ServerProcessClient.start(local, env));
  clients.set('lambda', await LambdaClient.create(aws));
}, 120_000);

afterAll(async () => {
  for (const client of clients.values()) await client.close();
  await Promise.all(projects.map((project) => project.dispose()));
  await upstream?.stop();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each(HOSTS.map((host) => [TITLES[host], host] as const))('HTTP API example through the %s', (_title, host) => {
  it.each(scenariosFor(HTTP[host], SCENARIOS))('%s', async (_name, scenario) => {
    await verify(clients.get(host)!, scenario);
  });
});

describe('HTTP API example coverage', () => {
  it('reached every node of the workflow in the exported backend', () => {
    const express = clients.get('express') as ExpressClient;
    expect(nodeIds(example).filter((id) => !express.executed.has(id))).toEqual([]);
  });

  it('sent every outbound method to the upstream API', () => {
    expect(new Set(upstream.requests.map((request) => request.method))).toEqual(new Set(['GET', 'POST', 'PUT', 'DELETE']));
    expect(upstream.requests.every((request) => request.forwardedBy === 'RunFlux')).toBe(true);
  });
});
