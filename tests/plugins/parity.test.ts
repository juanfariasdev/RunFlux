import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWorkflow } from '@runflux/validation-runtime';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import { ExportedProject } from '../support/exported-project';
import { compile, edge, editorRegistry, node, workflow } from '../support/workflows';

/**
 * Every plugin must behave the same in the editor's test runs and in an exported backend: both run
 * the same definition, but the backend runs the bundled copy. Each case starts with a manual
 * trigger, seeds the input with a Set node and checks the node under test.
 */
function scenario(target: ReturnType<typeof node>, seed: Record<string, unknown> = {}): WorkflowDefinition {
  const fields = Object.entries(seed).map(([name, value]) => ({ name, value }));
  return workflow(
    [node('start', 'trigger-manual-example', { label: 'Parity' }), node('seed', 'set', { fields }), target],
    [edge('start', 'seed'), edge('seed', target.id)],
  );
}

async function inEditor(definition: WorkflowDefinition) {
  const run = await runWorkflow(definition, await editorRegistry(), { mode: 'production' });
  return run.nodeResults.find((result) => result.nodeId === 'under-test');
}

async function inBackend(definition: WorkflowDefinition) {
  const project = await ExportedProject.write(await compile(definition));
  try {
    const execution = await (await project.engine()).run();
    return execution.records.find((record: { nodeId: string }) => record.nodeId === 'under-test');
  } finally {
    await project.dispose();
  }
}

async function expectParity(definition: WorkflowDefinition, expected: { output?: unknown; error?: string | null }) {
  const [editor, backend] = [await inEditor(definition), await inBackend(definition)];
  expect(editor).toMatchObject(expected);
  expect(backend).toMatchObject(expected);
  expect(backend.output ?? null).toEqual(editor?.output);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('plugins behave the same in the editor and in exported backends', () => {
  it('set composes typed fields from expressions', async () => {
    await expectParity(scenario(node('under-test', 'set', { includeOtherFields: true, fields: [
      { name: 'name', value: '{{ $json.first }} {{ $json.last }}', type: 'string' },
      { name: 'count', value: '42', type: 'number' },
    ] }), { first: 'Ada', last: 'Lovelace' }), { output: { first: 'Ada', last: 'Lovelace', name: 'Ada Lovelace', count: 42 }, error: null });
  });

  it.each([
    ['condition-if', { conditions: [{ leftValue: '{{ $json.amount }}', operator: 'greaterThan', rightValue: 100 }] }],
    ['filter', { conditions: [{ leftValue: '{{ $json.amount }}', operator: 'greaterThan', rightValue: 100 }] }],
    ['condition-switch', { rules: [{ conditions: [{ leftValue: '{{ $json.amount }}', operator: 'lessThan', rightValue: 10 }] }], fallbackEnabled: true }],
  ])('%s routes its input identically', async (pluginId, parameters) => {
    const definition = scenario(node('under-test', pluginId, parameters), { amount: 250 });
    const [editor, backend] = [await inEditor(definition), await inBackend(definition)];
    expect(backend).toMatchObject({ output: { amount: 250 }, error: null });
    expect(backend.activeOutput).toBe(pluginId === 'condition-switch' ? 'fallback' : pluginId === 'filter' ? 'main' : 'true');
    expect(editor).toMatchObject({ output: { amount: 250 }, error: null });
  });

  it('code-javascript reads $json and $node and never interpolates its source', async () => {
    await expectParity(scenario(node('under-test', 'code-javascript', { code: 'return { label: $node.start.json.label, doubled: $json.n * 2, literal: "{{ $json.n }}" };' }), { n: 21 }),
      { output: { label: 'Parity', doubled: 42, literal: '{{ $json.n }}' }, error: null });
  });

  it('code-javascript reports failures with the same message', async () => {
    await expectParity(scenario(node('under-test', 'code-javascript', { code: 'throw new Error("broken");' })), { error: '[code-javascript]: Execution error: broken' });
  });

  it('log-output logs and passes its input through', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expectParity(scenario(node('under-test', 'log-output', { label: 'Invoice' }), { total: 42 }), { output: { total: 42 }, error: null });
    expect(log.mock.calls.filter(([message]) => message === '[log-output] Invoice:')).toHaveLength(2);
  });

  it('http-output sends the same request and outputs the same response', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ accepted: true }, { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    await expectParity(scenario(node('under-test', 'http-output', { method: 'post', url: 'https://example.test/orders/{{ $json.id }}', body: { total: '{{ $json.total }}' } }), { id: 7, total: 9 }),
      { output: { status: 201, headers: { 'content-type': 'application/json' }, body: { accepted: true } }, error: null });
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.body])).toEqual([
      ['https://example.test/orders/7', '{"total":9}'],
      ['https://example.test/orders/7', '{"total":9}'],
    ]);
  });

  it('http-output reports unsuccessful responses identically', async () => {
    vi.stubGlobal('fetch', async () => new Response('down', { status: 503 }));
    await expectParity(scenario(node('under-test', 'http-output', { url: 'https://example.test/down' })), { error: 'http-output: request to https://example.test/down failed with status 503: down' });
  });

  it('triggers stamp their payload identically', async () => {
    const cron = workflow([node('under-test', 'trigger-cron', { expression: '0 * * * *', timezone: 'UTC' })]);
    await expectParity(cron, { output: { triggeredAt: '2026-01-01T12:00:00.000Z', cronExpression: '0 * * * *', timezone: 'UTC' } });
    const manual = workflow([node('under-test', 'trigger-manual-example', { label: 'Import' })]);
    await expectParity(manual, { output: { label: 'Import', triggeredAt: '2026-01-01T12:00:00.000Z' } });
    // A production run without a request gets an empty one, never the editor's sample.
    const webhook = workflow([node('under-test', 'trigger-webhook', { sampleBody: [{ name: 'id', value: '42', type: 'number' }] })]);
    await expectParity(webhook, { output: { data: undefined, _headers: {}, _query: {} } });
  });

  it('invalid configuration fails with the same message', async () => {
    await expectParity(scenario(node('under-test', 'condition-if', { conditions: [{ operator: 'nearly' }] })), { error: 'condition-if: parameter "conditions" row 1 uses unknown operator "nearly"' });
  });
});
