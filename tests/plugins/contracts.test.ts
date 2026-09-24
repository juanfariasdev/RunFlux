import { afterEach, describe, expect, it, vi } from 'vitest';
import { compiledRun, context, loadPlugin } from './helpers';
import { resolveTemplateObject } from '@runflux/plugin-system/evaluator';

afterEach(() => vi.restoreAllMocks());

describe('plugin execution contracts', () => {
  it('log-output emits the same structured value and preserves its input on every target', async () => {
    const plugin = await loadPlugin('log-output');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const input = { total: 42 };
    const params = { label: 'Invoice' };
    expect(await plugin.execute!(params, input, context)).toBe(input);
    for (const platform of plugin.manifest.supportedPlatforms) {
      expect(await compiledRun(plugin, platform, params)(input, context)).toBe(input);
    }
    expect(log.mock.calls).toEqual(Array.from({ length: 3 }, () => ['[log-output] Invoice:', input]));
  });

  it('code-javascript handles missing nodes and reports execution failures identically in compiled backends', async () => {
    const plugin = await loadPlugin('code-javascript');
    const params = { code: 'return { missing: $node["absent"].json, doubled: await Promise.resolve($json.count * 2) };' };
    const expected = { missing: undefined, doubled: 8 };
    expect(await plugin.execute!(params, { count: 4 }, context)).toEqual(expected);
    for (const platform of plugin.manifest.supportedPlatforms) {
      expect(await compiledRun(plugin, platform, params)({ count: 4 }, context)).toEqual(expected);
      await expect(compiledRun(plugin, platform, { code: 'throw new Error("broken");' })({}, context)).rejects.toThrow('[code-javascript]: Execution error: broken');
    }
  });

  it('http-output preserves explicit content type and does not invent a body when none was supplied', async () => {
    const plugin = await loadPlugin('http-output');
    const requests: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      requests.push(init);
      return new Response('{"accepted":true}', { status: 201, headers: { 'content-type': 'application/json' } });
    });
    try {
      const params = { method: 'post', url: 'https://example.test/events', headers: { 'content-type': 'application/custom+json' } };
      const expected = { status: 201, headers: { 'content-type': 'application/json' }, body: { accepted: true } };
      expect(await plugin.execute!(params, {}, context)).toEqual(expected);
      for (const platform of plugin.manifest.supportedPlatforms) {
        expect(await compiledRun(plugin, platform, params)({}, context)).toEqual(expected);
      }
      for (const request of requests) {
        expect(request.body).toBeUndefined();
        expect(new Headers(request.headers).get('content-type')).toBe('application/custom+json');
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it('set keeps missing expressions empty while composing typed fields without mutating the input', async () => {
    const plugin = await loadPlugin('set');
    const input = { first: 'Ada', last: 'Lovelace' };
    const params = { includeOtherFields: true, fields: [
      { name: 'name', value: '{{ $json.first }} {{ $json.last }}', type: 'string' },
      { name: 'optional', value: '{{ $json.missing }}', type: 'string' },
      { name: 'count', value: '42', type: 'number' },
    ] };
    const expected = { first: 'Ada', last: 'Lovelace', name: 'Ada Lovelace', optional: '', count: 42 };
    expect(await plugin.execute!(resolveTemplateObject(params, { $json: input }), input, context)).toEqual(expected);
    for (const platform of plugin.manifest.supportedPlatforms) {
      expect(await compiledRun(plugin, platform, params)(input, context)).toEqual(expected);
    }
    expect(input).toEqual({ first: 'Ada', last: 'Lovelace' });
  });

  it.each(['condition-if', 'filter', 'condition-switch'])('%s compares Date values consistently in the editor and generated code', async (id) => {
    const plugin = await loadPlugin(id);
    const input = { a: new Date('2026-01-01'), b: new Date('2026-01-02') };
    const conditions = [{ leftValue: '{{ $json.a }}', operator: 'equals', rightValue: '{{ $json.b }}' }];
    const params = id === 'condition-switch' ? { rules: [{ conditions }], fallbackEnabled: true } : { conditions };
    const expected = { value: input, activeOutput: id === 'condition-if' ? 'false' : id === 'condition-switch' ? 'fallback' : null };
    expect(await plugin.execute!(resolveTemplateObject(params, { $json: input }), input, context)).toEqual(expected);
    for (const platform of plugin.manifest.supportedPlatforms) {
      expect(await compiledRun(plugin, platform, params)(input, context)).toEqual(expected);
    }
  });

  it('webhook forwards body, headers and query through its declared main output on every target', async () => {
    const plugin = await loadPlugin('trigger-webhook');
    const input = { body: { id: 42 }, headers: { authorization: 'example' }, query: { page: '2' } };
    const expected = { value: { id: 42, _headers: input.headers, _query: input.query }, activeOutput: 'main' };
    expect(await plugin.execute!({}, input, context)).toEqual(expected);
    for (const platform of plugin.manifest.supportedPlatforms) {
      expect(await compiledRun(plugin, platform, {})(input, context)).toEqual(expected);
    }
  });

  it('manual trigger returns the same payload from the editor and generated backend', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
    try {
      const plugin = await loadPlugin('trigger-manual-example');
      const params = { label: 'Import' };
      const expected = { id: 42, label: 'Import', triggeredAt: '2026-01-01T12:00:00.000Z' };
      expect(await plugin.execute!(params, { id: 42 }, context)).toEqual(expected);
      expect(await compiledRun(plugin, 'local', params)({ id: 42 }, context)).toEqual(expected);
    } finally { vi.useRealTimers(); }
  });

  it('cron activates main and preserves the scheduled payload in the editor and both targets', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
    try {
      const plugin = await loadPlugin('trigger-cron');
      const params = { expression: '0 * * * *', timezone: 'UTC' };
      const expected = { value: { job: 'sync', triggeredAt: '2026-01-01T12:00:00.000Z', cronExpression: '0 * * * *', timezone: 'UTC' }, activeOutput: 'main' };
      expect(await plugin.execute!(params, { job: 'sync' }, context)).toEqual(expected);
      for (const platform of plugin.manifest.supportedPlatforms) {
        expect(await compiledRun(plugin, platform, params)({ job: 'sync' }, context)).toEqual(expected);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
