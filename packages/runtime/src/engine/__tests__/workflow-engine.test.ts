import { describe, expect, it, vi } from 'vitest';
import { defineNode, NodeOutput } from '../../contracts/node.js';
import type { Clock, Logger } from '../../contracts/services.js';
import { ServiceKey, ServiceRegistry, type ServiceLookup } from '../../services/service-registry.js';
import { WorkflowDocumentError } from '../../workflow/executable-workflow.js';
import { CyclicWorkflowError } from '../../workflow/workflow-graph.js';
import { StaticNodeCatalog } from '../node-catalog.js';
import { EngineDisposedError, WorkflowEngine, type WorkflowEngineOptions } from '../workflow-engine.js';
import { definitions, workflow } from './fixtures.js';

const catalog = new StaticNodeCatalog(definitions);
const engine = (document: ReturnType<typeof workflow>, options?: WorkflowEngineOptions) => new WorkflowEngine(document, catalog, options);

describe('WorkflowEngine.run', () => {
  it('passes each output to the next node and reports the last one as the result', async () => {
    const execution = await engine(workflow(
      [{ id: 'start', pluginId: 'start' }, { id: 'a', pluginId: 'emit', parameters: { value: 'A' } }, { id: 'b', pluginId: 'emit' }],
      [['start', 'a'], ['a', 'b']],
    )).run({ payload: { id: 1 } });
    expect(execution.records.map((record) => [record.nodeId, record.input, record.output])).toEqual([['start', { id: 1 }, { id: 1 }], ['a', { id: 1 }, 'A'], ['b', 'A', 'A']]);
    expect(execution.toResponse()).toEqual({ success: true, result: 'A', nodeOutputs: { start: { id: 1 }, a: 'A', b: 'A' } });
    expect(execution.status).toBe('success');
  });

  it('only follows the connection of the output a node activated', async () => {
    const execution = await engine(workflow(
      [{ id: 'start', pluginId: 'start' }, { id: 'if', pluginId: 'branch', parameters: { take: 'false' } }, { id: 'yes', pluginId: 'emit', parameters: { value: 'yes' } }, { id: 'no', pluginId: 'emit', parameters: { value: 'no' } }],
      [['start', 'if'], ['if', 'yes', 'true'], ['if', 'no', 'false']],
    )).run();
    expect(execution.record('yes')).toBeUndefined();
    expect(execution.result()).toBe('no');
  });

  it('waits for every parent of a merge and passes the active outputs in connection order', async () => {
    const execution = await engine(workflow(
      [{ id: 'start', pluginId: 'start' }, { id: 'slow', pluginId: 'emit', parameters: { value: 'slow', delay: 15 } }, { id: 'fast', pluginId: 'emit', parameters: { value: 'fast' } }, { id: 'merge', pluginId: 'emit' }],
      [['start', 'slow'], ['start', 'fast'], ['slow', 'merge'], ['fast', 'merge']],
    )).run();
    expect(execution.record('merge')?.input).toEqual(['slow', 'fast']);
    expect(execution.records.map((record) => record.nodeId)).toEqual(['start', 'fast', 'slow', 'merge']);
  });

  it('gives a merge only the inputs of its active parents', async () => {
    const execution = await engine(workflow(
      [{ id: 'start', pluginId: 'start' }, { id: 'if', pluginId: 'branch', parameters: { take: 'true' } }, { id: 'other', pluginId: 'emit', parameters: { value: 'other' } }, { id: 'merge', pluginId: 'emit' }],
      [['start', 'if'], ['start', 'other'], ['if', 'merge', 'false'], ['other', 'merge']],
    )).run({ payload: 'payload' });
    expect(execution.record('merge')?.input).toBe('other');
  });

  it('ends a branch without an error when a node activates no output', async () => {
    const execution = await engine(workflow(
      [{ id: 'start', pluginId: 'start' }, { id: 'filter', pluginId: 'branch', parameters: { take: 'halt' } }, { id: 'after', pluginId: 'emit' }],
      [['start', 'filter'], ['filter', 'after', 'true']],
    )).run({ payload: 'kept' });
    expect(execution.record('after')).toBeUndefined();
    expect(execution.toResponse()).toEqual({ success: true, result: 'kept', nodeOutputs: { start: 'kept', filter: 'kept' } });
  });

  it('records a failure, skips its descendants and still runs independent branches', async () => {
    const execution = await engine(workflow(
      [{ id: 'start', pluginId: 'start' }, { id: 'broken', pluginId: 'fail', parameters: { message: 'database down' } }, { id: 'after', pluginId: 'emit' }, { id: 'other', pluginId: 'emit', parameters: { value: 'ok' } }],
      [['start', 'broken'], ['broken', 'after'], ['start', 'other']],
    )).run();
    expect(execution.record('broken')).toMatchObject({ output: null, activeOutput: null, error: 'database down' });
    expect(execution.record('after')).toBeUndefined();
    expect(execution.record('other')?.output).toBe('ok');
    expect(execution.status).toBe('partial');
    expect(execution.toResponse()).toEqual({ success: false, result: null, nodeOutputs: { start: undefined, other: 'ok' }, error: 'database down' });
  });

  it('reports "error" when the first node to finish failed and "partial" when a later one did', async () => {
    const first = await new WorkflowEngine(workflow([{ id: 'start', pluginId: 'start' }], []), new StaticNodeCatalog({ start: definitions.fail })).run();
    expect(first.status).toBe('error');
    expect(first.error).toBe('boom');
    const later = await engine(workflow([{ id: 'start', pluginId: 'start' }, { id: 'x', pluginId: 'fail' }], [['start', 'x']])).run();
    expect(later.status).toBe('partial');
  });

  it('runs only nodes reachable from the started triggers', async () => {
    const document = workflow(
      [{ id: 'orders', pluginId: 'start' }, { id: 'events', pluginId: 'start' }, { id: 'afterOrders', pluginId: 'emit' }, { id: 'island', pluginId: 'emit' }],
      [['orders', 'afterOrders']],
    );
    const execution = await engine(document).run({ payload: 1, triggerId: 'orders' });
    expect(execution.records.map((record) => record.nodeId)).toEqual(['orders', 'afterOrders']);
    expect((await engine(document).run()).records.map((record) => record.nodeId).sort()).toEqual(['afterOrders', 'events', 'orders']);
  });

  it('rejects a start node that is not a trigger', async () => {
    await expect(engine(workflow([{ id: 'a', pluginId: 'emit' }], [])).run({ triggerId: 'a' })).rejects.toThrow('Node "a" is not a trigger');
  });

  it('finishes a run of several triggers of the same plugin as soon as one of them fires', async () => {
    const execution = await new WorkflowEngine(
      workflow([{ id: 'fires', pluginId: 'start', parameters: { fires: true } }, { id: 'waits', pluginId: 'start' }], []),
      new StaticNodeCatalog({ start: defineNode({
        parseParameters: (parameters) => ({ fires: parameters.boolean('fires', false) }),
        createHandler: () => ({
          execute: ({ parameters, context }) => parameters.fires
            ? NodeOutput.main('fired')
            : new Promise<NodeOutput>((_resolve, reject) => context.signal.addEventListener('abort', () => reject(new Error('cancelled')))),
        }),
      }) }),
    ).run();
    expect(execution.record('fires')?.output).toBe('fired');
    expect(execution.record('waits')).toBeUndefined();
    expect(execution.status).toBe('success');
  });

  it('runs a merge of racing triggers with the trigger that fired', async () => {
    const racing = defineNode({
      parseParameters: (parameters) => ({ fires: parameters.boolean('fires', false) }),
      createHandler: () => ({
        execute: ({ parameters, context }) => parameters.fires
          ? NodeOutput.main('fired')
          : new Promise<NodeOutput>((_resolve, reject) => context.signal.addEventListener('abort', () => reject(new Error('cancelled')))),
      }),
    });
    const execution = await new WorkflowEngine(
      workflow([{ id: 'a', pluginId: 'start', parameters: { fires: true } }, { id: 'b', pluginId: 'start' }, { id: 'merge', pluginId: 'emit' }], [['a', 'merge'], ['b', 'merge']]),
      new StaticNodeCatalog({ start: racing, emit: definitions.emit }),
    ).run();
    expect(execution.toResponse()).toEqual({ success: true, result: 'fired', nodeOutputs: { a: 'fired', merge: 'fired' } });
  });

  it('never cancels triggers of other plugins', async () => {
    const onAbort = vi.fn();
    const document = workflow([{ id: 'manual', pluginId: 'start' }, { id: 'webhook', pluginId: 'waiting' }], []);
    const running = new WorkflowEngine(document, new StaticNodeCatalog({
      start: definitions.start,
      waiting: defineNode({ parseParameters: () => ({}), createHandler: () => ({ execute: ({ context }) => {
        context.signal.addEventListener('abort', onAbort);
        return new Promise<NodeOutput>((resolve) => setTimeout(() => resolve(NodeOutput.main('late')), 20));
      } }) }),
    })).run();
    const execution = await running;
    expect(onAbort).not.toHaveBeenCalled();
    expect(execution.record('webhook')?.output).toBe('late');
  });

  it('resolves expressions from $json, $node (by id and label) and $env, keeping literal parameters verbatim', async () => {
    const execution = await engine(workflow(
      [{ id: 'start', pluginId: 'start' }, { id: 'first', pluginId: 'emit', parameters: { value: { total: 42 } }, label: 'First' }, { id: 'inspect', pluginId: 'inspect', parameters: { expression: '{{ $json.total + $node.first.json.total }}', literal: '{{ $json.total }}' } }],
      [['start', 'first'], ['first', 'inspect']],
    ), { environment: { RUNFLUX_TEST: 'env' }, mode: 'sandbox' }).run();
    expect(execution.record('inspect')?.output).toEqual({
      parameters: { expression: 84, literal: '{{ $json.total }}' }, input: { total: 42 }, mode: 'sandbox', nodeId: 'inspect', workflowId: 'test', env: 'env',
      previous: { total: 42 }, labelled: { total: 42 }, missing: undefined,
    });
  });

  it.each([
    ['a plugin that is not installed', { id: 'x', pluginId: 'absent' }, 'Plugin "absent" is not installed'],
    ['an invalid parameter', { id: 'x', pluginId: 'branch', parameters: { take: 'maybe' } }, 'branch: parameter "take" must be one of "true", "false", "halt"'],
    ['a failing expression', { id: 'x', pluginId: 'emit', parameters: { value: '{{ $json.a.b }}' } }, 'Expression "$json.a.b" failed'],
  ])('records %s as the node error', async (_case, node, message) => {
    const execution = await engine(workflow([{ id: 'start', pluginId: 'start' }, node], [['start', 'x']])).run({ payload: {} });
    expect(execution.record('x')?.error).toContain(message);
  });

  it.each([
    ['an unknown output', NodeOutput.route('value', 'sideways'), 'Node "x" activated unknown output "sideways"'],
    ['something that is not a NodeOutput', 'plain value', 'Node "x" must return a NodeOutput'],
  ])('rejects %s returned by a handler', async (_case, returned, message) => {
    const execution = await new WorkflowEngine(workflow([{ id: 'x', pluginId: 'start' }], []), new StaticNodeCatalog({
      start: defineNode({ parseParameters: () => ({}), createHandler: () => ({ execute: () => returned as NodeOutput }) }),
    })).run();
    expect(execution.record('x')?.error).toBe(message);
  });

  it('rejects cyclic workflows when it is created', () => {
    expect(() => engine(workflow([{ id: 'a', pluginId: 'emit' }, { id: 'b', pluginId: 'emit' }], [['a', 'b'], ['b', 'a']]))).toThrow(CyclicWorkflowError);
  });

  it('returns an empty, successful execution for a workflow without triggers', async () => {
    expect((await engine(workflow([{ id: 'a', pluginId: 'emit' }], [])).run()).toResponse()).toEqual({ success: true, result: null, nodeOutputs: {} });
  });
});

describe('WorkflowEngine $node', () => {
  it('holds the outputs of ancestors only, so parallel branches never see each other', async () => {
    const execution = await engine(workflow(
      [{ id: 'start', pluginId: 'start' }, { id: 'first', pluginId: 'emit', parameters: { value: 'ancestor' } }, { id: 'sibling', pluginId: 'emit', parameters: { value: 'sibling' } }, { id: 'inspect', pluginId: 'inspect', parameters: { expression: '{{ $node.sibling.json }}' } }],
      [['start', 'first'], ['start', 'sibling'], ['first', 'inspect']],
    )).run();
    expect(execution.record('inspect')?.output).toMatchObject({ previous: 'ancestor', parameters: { expression: undefined } });
  });

  it('lets a node id win over a label equal to it, and keeps __proto__ an ordinary name', async () => {
    const execution = await engine(workflow(
      [{ id: 'start', pluginId: 'start', label: 'first' }, { id: 'first', pluginId: 'emit', parameters: { value: 'by id' }, label: '__proto__' }, { id: 'inspect', pluginId: 'inspect', parameters: { expression: '{{ $node["__proto__"].json }}' } }],
      [['start', 'first'], ['first', 'inspect']],
    )).run({ payload: 'payload' });
    expect(execution.record('inspect')?.output).toMatchObject({ previous: 'by id', parameters: { expression: 'by id' } });
  });
});

describe('WorkflowEngine cancellation and lifecycle', () => {
  const blocking = () => {
    let release!: () => void;
    const started = new Promise<void>((resolve) => { release = resolve; });
    let unblock!: () => void;
    const definition = defineNode({
      parseParameters: () => ({}),
      createHandler: () => ({
        execute: ({ context }) => new Promise<NodeOutput>((resolve) => {
          release();
          unblock = () => resolve(NodeOutput.main('done'));
          context.signal.addEventListener('abort', () => resolve(NodeOutput.main('aborted')));
        }),
      }),
    });
    return { definition, started, unblock: () => unblock() };
  };

  it('stops starting nodes once the run is cancelled and passes the signal to running ones', async () => {
    const node = blocking();
    const controller = new AbortController();
    const running = new WorkflowEngine(
      workflow([{ id: 'start', pluginId: 'start' }, { id: 'slow', pluginId: 'slow' }, { id: 'after', pluginId: 'emit' }], [['start', 'slow'], ['slow', 'after']]),
      new StaticNodeCatalog({ start: definitions.start, slow: node.definition, emit: definitions.emit }),
    ).run({ signal: controller.signal });
    await node.started;
    controller.abort();
    const execution = await running;
    expect(execution.record('slow')?.output).toBe('aborted');
    expect(execution.record('after')).toBeUndefined();
    expect(execution.cancelled).toBe(true);
    expect(execution.toResponse()).toMatchObject({ success: false, error: 'The workflow run was cancelled' });
  });

  it('waits for runs in progress before disposing, then refuses new runs', async () => {
    const node = blocking();
    const dispose = vi.fn(async () => {});
    const run = new WorkflowEngine(workflow([{ id: 'slow', pluginId: 'start' }], []), new StaticNodeCatalog({
      start: { ...node.definition, createHandler: (services) => ({ ...node.definition.createHandler(services), dispose }) },
    }));
    const running = run.run();
    await node.started;
    const disposed = run.dispose();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(dispose).not.toHaveBeenCalled();
    node.unblock();
    expect((await running).record('slow')?.output).toBe('done');
    await disposed;
    expect(dispose).toHaveBeenCalledOnce();
    await expect(run.run()).rejects.toThrow(EngineDisposedError);
    await expect(run.runNode('slow')).rejects.toThrow('The workflow engine was disposed');
  });
});

describe('WorkflowEngine.runNode', () => {
  const document = workflow(
    [{ id: 'first', pluginId: 'start', label: 'First' }, { id: 'second', pluginId: 'emit' }, { id: 'inspect', pluginId: 'inspect' }],
    [['first', 'inspect'], ['second', 'inspect']],
  );
  const record = (nodeId: string, output: unknown) => ({ nodeId, input: null, output, activeOutput: 'main', error: null, startedAt: 't', finishedAt: 't' });

  it('uses the outputs of earlier records as input and $node', async () => {
    const result = await engine(document).runNode('inspect', { previous: [record('first', 'a'), record('second', 'b')] });
    expect(result.output).toMatchObject({ input: ['a', 'b'], previous: 'a', labelled: 'a' });
  });

  it('passes null for parents without a record and undefined to nodes without parents', async () => {
    expect((await engine(document).runNode('inspect', { previous: [record('second', 'b')] })).input).toEqual([null, 'b']);
    expect((await engine(document).runNode('first')).input).toBeUndefined();
  });

  it('ignores failed records', async () => {
    const failed = { ...record('first', 'stale'), error: 'boom' };
    const result = await engine(document).runNode('inspect', { previous: [failed, record('second', 'b')] });
    expect(result.output).toMatchObject({ input: [null, 'b'], previous: undefined });
  });

  it('rejects unknown nodes', async () => {
    await expect(engine(document).runNode('ghost')).rejects.toThrow('Unknown node "ghost" in workflow "test"');
  });
});

describe('WorkflowEngine services and lifecycle', () => {
  it('gives handlers the configured services and creates one handler per plugin', async () => {
    const logger: Logger = { info: vi.fn(), error: vi.fn() };
    const clock: Clock = { now: () => new Date('2026-01-01T00:00:00.000Z') };
    const key = new ServiceKey<string>('greeting');
    const createHandler = vi.fn(({ logger, extensions }: { logger: Logger; extensions: ServiceLookup }) => ({
      execute: () => {
        logger.info('ran');
        return NodeOutput.main(extensions.get(key));
      },
    }));
    const document = workflow([{ id: 'a', pluginId: 'start' }, { id: 'b', pluginId: 'start' }], []);
    const run = new WorkflowEngine(document, new StaticNodeCatalog({ start: defineNode({ parseParameters: () => ({}), createHandler }) }), {
      services: { logger, clock, extensions: new ServiceRegistry().set(key, 'hello') },
    });
    const execution = await run.run();
    await run.run();
    expect(execution.records.map((record) => record.output)).toEqual(['hello', 'hello']);
    expect(execution.records[0]).toMatchObject({ startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:00.000Z' });
    expect(execution.startedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(createHandler).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledTimes(4);
  });

  it('retries creating a handler that failed to be created', async () => {
    const createHandler = vi.fn()
      .mockImplementationOnce(() => { throw new Error('not ready'); })
      .mockImplementation(() => ({ execute: () => NodeOutput.main('ready') }));
    const run = new WorkflowEngine(workflow([{ id: 'a', pluginId: 'start' }], []), new StaticNodeCatalog({ start: defineNode({ parseParameters: () => ({}), createHandler }) }));
    expect((await run.run()).record('a')?.error).toBe('not ready');
    expect((await run.run()).record('a')?.output).toBe('ready');
  });

  it('disposes every handler once', async () => {
    const dispose = vi.fn(async () => {});
    const run = new WorkflowEngine(workflow([{ id: 'a', pluginId: 'start' }], []), new StaticNodeCatalog({
      start: defineNode({ parseParameters: () => ({}), createHandler: () => ({ execute: () => NodeOutput.main(1), dispose }) }),
    }));
    await run.run();
    await Promise.all([run.dispose(), run.dispose()]);
    expect(dispose).toHaveBeenCalledOnce();
  });
});

describe('WorkflowEngine.fromDocument', () => {
  const document = JSON.parse(JSON.stringify(workflow([{ id: 'start', pluginId: 'start' }], [])));

  it('accepts plugins as a record or as a catalog', async () => {
    expect((await WorkflowEngine.fromDocument(document, definitions).run({ payload: 1 })).result()).toBe(1);
    expect((await WorkflowEngine.fromDocument(document, catalog).run({ payload: 2 })).result()).toBe(2);
  });

  it('rejects invalid documents', () => {
    expect(() => WorkflowEngine.fromDocument({ ...document, nodes: 'none' }, definitions)).toThrow(WorkflowDocumentError);
  });
});
