import { validateManifest } from '@runflux/plugin-system/manifest-validator';
import { WebhookTestHub } from '@runflux/plugin-system/webhook-test-hub';
import { ObjectParameterReader } from '@runflux/runtime';
import { executeNode } from '@runflux/runtime/testing';
import { describe, expect, it, vi } from 'vitest';
import { deployment, manifest } from '../index';
import webhook from '../runtime';

const run = (parameters: Record<string, unknown>, input?: unknown, extra: Parameters<typeof executeNode>[1] = {}) =>
  executeNode(webhook, { parameters, input, outputs: manifest.outputs, pluginId: 'trigger-webhook', ...extra });
const reader = (values: Record<string, unknown>) => new ObjectParameterReader(values, 'trigger-webhook');

describe('trigger-webhook runtime', () => {
  it('declares a valid trigger manifest with a main output', () => {
    expect(validateManifest(manifest).success).toBe(true);
    expect(manifest.outputs).toEqual(['main']);
  });

  it('exposes the JSON body fields next to the headers and query of a request', async () => {
    const record = await run({}, { body: { id: 42 }, headers: { authorization: 'Bearer 1' }, query: { page: '2' } });
    expect(record).toMatchObject({ activeOutput: 'main', output: { id: 42, _headers: { authorization: 'Bearer 1' }, _query: { page: '2' } } });
  });

  it.each([
    [{ body: 'plain text' }, { data: 'plain text', _headers: {}, _query: {} }],
    [{ body: [1, 2] }, { data: [1, 2], _headers: {}, _query: {} }],
    [{ headers: { a: '1' } }, { data: undefined, _headers: { a: '1' }, _query: {} }],
    [{ id: 42 }, { id: 42, _headers: {}, _query: {} }],
    ['raw', { data: 'raw', _headers: {}, _query: {} }],
  ])('treats %j as a request (non-request payloads become its body)', async (input, output) => {
    expect((await run({}, input)).output).toEqual(output);
  });

  it('uses its sample when a test run has no request and nothing delivers one', async () => {
    const rows = [{ name: 'id', value: '42', type: 'number' }, { name: 'customer', value: 'Alice', type: 'string' }];
    expect((await run({ sampleBody: rows, sampleHeaders: { 'x-sample': '1' }, sampleQuery: { q: 'a' } })).output)
      .toEqual({ id: 42, customer: 'Alice', _headers: { 'x-sample': '1' }, _query: { q: 'a' } });
    expect((await run({ sampleBody: { literal: true } })).output).toEqual({ literal: true, _headers: {}, _query: {} });
    expect((await run({})).output).toEqual({ message: 'Sample webhook payload', _headers: {}, _query: {} });
  });

  it('never uses its sample in production', async () => {
    const record = await run({ sampleBody: [{ name: 'id', value: '42', type: 'number' }] }, undefined, { mode: 'production' });
    expect(record.output).toEqual({ data: undefined, _headers: {}, _query: {} });
  });

  it('waits on its own method, so webhooks sharing a path receive their own test requests', async () => {
    const hub = new WebhookTestHub();
    const reading = run({ path: '/items', httpMethod: 'GET' }, undefined, { services: { triggerEvents: hub } });
    const writing = run({ path: '/items', httpMethod: 'POST' }, undefined, { services: { triggerEvents: hub } });
    await vi.waitFor(() => expect(hub.pending).toBe(2));
    hub.deliver('/items', { method: 'POST', body: { id: 'post' } });
    hub.deliver('/items', { method: 'GET', query: { id: 'get' } });
    expect((await writing).output).toEqual({ id: 'post', _headers: {}, _query: {} });
    expect((await reading).output).toEqual({ data: undefined, _headers: {}, _query: { id: 'get' } });
  });

  it('waits for the test request in a production test run of the editor too', async () => {
    const hub = new WebhookTestHub();
    const pending = run({ path: '/orders' }, undefined, { mode: 'production', services: { triggerEvents: hub } });
    await vi.waitFor(() => expect(hub.pending).toBe(1));
    hub.deliver('/orders', { body: { id: 7 } });
    expect((await pending).output).toEqual({ id: 7, _headers: {}, _query: {} });
  });

  it('waits for a test request on its path when the editor delivers them', async () => {
    const hub = new WebhookTestHub();
    const pending = run({ path: '/orders' }, undefined, { services: { triggerEvents: hub } });
    await vi.waitFor(() => expect(hub.pending).toBe(1));
    expect(hub.deliver('/unrelated', { body: { wrong: true } })).toBe(false);
    expect(hub.deliver('/orders', { body: { paymentId: 'pay-1' }, headers: { 'x-event': 'paid' }, query: { live: 'false' } })).toBe(true);
    expect((await pending).output).toEqual({ paymentId: 'pay-1', _headers: { 'x-event': 'paid' }, _query: { live: 'false' } });
  });

  it('stops waiting when its run no longer needs it', async () => {
    const hub = new WebhookTestHub();
    const controller = new AbortController();
    const pending = run({ path: '/cancelled' }, undefined, { services: { triggerEvents: hub }, signal: controller.signal });
    await vi.waitFor(() => expect(hub.pending).toBe(1));
    controller.abort();
    expect((await pending).error).toMatch(/another trigger.*already fired/);
    expect(hub.pending).toBe(0);
  });

  it.each([
    [{ path: '/orders?x=1' }, 'trigger-webhook: parameter "path" must be a URL path without query, fragment or whitespace'],
    [{ path: '/orders#top' }, 'must be a URL path without query, fragment or whitespace'],
    [{ sampleBody: [{ name: 'n', value: 'x', type: 'number' }] }, 'Field "n" must be a number'],
  ])('reports invalid configuration %j', async (parameters, message) => {
    expect((await run(parameters)).error).toContain(message);
  });
});

describe('trigger-webhook deployment', () => {
  it('declares its endpoint with defaults', () => {
    expect(deployment?.triggers?.(reader({}))).toEqual([{ kind: 'http', path: '/webhook', method: 'POST', authentication: { type: 'none' }, rawBody: false }]);
  });

  it.each(['secret', 'headerAuth'])('maps %s authentication to a header secret and declares its variable', (authentication) => {
    const parameters = reader({ path: '/orders', httpMethod: 'put', authentication, headerName: 'X-Orders-Key', secretEnvVar: 'ORDERS_KEY', rawBody: true });
    expect(deployment?.triggers?.(parameters)).toEqual([{
      kind: 'http', path: '/orders', method: 'PUT', rawBody: true,
      authentication: { type: 'header', headerName: 'X-Orders-Key', secretEnvVar: 'ORDERS_KEY' },
    }]);
    expect(deployment?.environment?.(parameters)).toEqual([{ key: 'ORDERS_KEY', description: 'Secret expected in X-Orders-Key' }]);
  });

  it('reads the legacy auth parameter and needs no variable without authentication', () => {
    expect(deployment?.triggers?.(reader({ auth: 'secret' }))?.[0]).toMatchObject({ authentication: { type: 'header', headerName: 'X-Webhook-Secret', secretEnvVar: 'WEBHOOK_SECRET' } });
    expect(deployment?.environment?.(reader({}))).toEqual([]);
  });

  it.each([
    [{ httpMethod: 'FETCH' }, 'parameter "httpMethod" "FETCH" is not an HTTP method'],
    [{ authentication: 'oauth' }, 'parameter "authentication" must be one of "none", "secret", "headerAuth"'],
    [{ path: '/with space' }, 'parameter "path" must be a URL path without query, fragment or whitespace'],
    [{ authentication: 'headerAuth', headerName: 'X Key' }, 'parameter "headerName" "X Key" is not an HTTP header name'],
    [{ authentication: 'headerAuth', secretEnvVar: 'MY-SECRET' }, 'parameter "secretEnvVar" "MY-SECRET" is not an environment variable name'],
  ])('rejects %j', (parameters, message) => {
    expect(() => deployment?.triggers?.(reader(parameters))).toThrow(message);
  });

  it('accepts ANY as a method', () => {
    expect(deployment?.triggers?.(reader({ httpMethod: 'any' }))?.[0]).toMatchObject({ method: 'ANY' });
  });

  it.each([['orders', '/orders'], ['/orders/', '/orders'], ['//hooks//orders', '/hooks/orders'], ['/', '/']])('declares path %j as %j', (path, route) => {
    expect(deployment?.triggers?.(reader({ path }))?.[0]).toMatchObject({ path: route });
  });

  it('offers every method and authentication mode the runtime accepts, and only those', () => {
    const options = (name: string) => manifest.parameters.find((parameter) => parameter.name === name)?.options?.map((option) => option.value) ?? [];
    for (const httpMethod of options('httpMethod')) expect(() => deployment?.triggers?.(reader({ httpMethod }))).not.toThrow();
    for (const authentication of options('authentication')) expect(() => deployment?.triggers?.(reader({ authentication }))).not.toThrow();
    expect(options('httpMethod')).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY']);
  });
});
