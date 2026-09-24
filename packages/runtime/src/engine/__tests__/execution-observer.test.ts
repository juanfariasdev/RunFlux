import { describe, expect, it, vi } from 'vitest';
import { defineNode, NodeOutput } from '../../contracts/node.js';
import type { Logger } from '../../contracts/services.js';
import type { ExecutionObserver, NodeFinishedEvent, RunStartedEvent } from '../execution-observer.js';
import { StaticNodeCatalog } from '../node-catalog.js';
import { WorkflowEngine } from '../workflow-engine.js';
import type { WorkflowExecution } from '../workflow-execution.js';
import { definitions, workflow } from './fixtures.js';

const catalog = new StaticNodeCatalog(definitions);
const linear = () => workflow(
  [{ id: 'start', pluginId: 'start' }, { id: 'a', pluginId: 'emit', parameters: { value: 'A' } }, { id: 'b', pluginId: 'emit' }],
  [['start', 'a'], ['a', 'b']],
);

function recorder() {
  const events: string[] = [];
  const started: RunStartedEvent[] = [];
  const finished: NodeFinishedEvent[] = [];
  const executions: WorkflowExecution[] = [];
  const observer: ExecutionObserver = {
    runStarted: (event) => { events.push(`run:${event.executionId}`); started.push(event); },
    nodeStarted: (event) => { events.push(`start:${event.nodeId}:${event.executionId}`); },
    nodeFinished: (event) => { events.push(`finish:${event.nodeId}:${event.executionId}`); finished.push(event); },
    runFinished: (event) => { events.push(`done:${event.executionId}`); executions.push(event.execution); },
  };
  return { observer, events, started, finished, executions };
}

describe('ExecutionObserver', () => {
  it('hears the run, each node start and finish, and the finished execution, in order', async () => {
    const { observer, events, started, finished, executions } = recorder();
    const execution = await new WorkflowEngine(linear(), catalog, { observer, createExecutionId: () => 'exec-1' }).run({ payload: { id: 1 } });
    expect(events).toEqual([
      'run:exec-1',
      'start:start:exec-1', 'finish:start:exec-1',
      'start:a:exec-1', 'finish:a:exec-1',
      'start:b:exec-1', 'finish:b:exec-1',
      'done:exec-1',
    ]);
    expect(started).toEqual([{ executionId: 'exec-1', workflowId: 'test', triggerId: undefined, targetNodeId: undefined, startedAt: execution.startedAt }]);
    expect(finished.map((event) => event.record)).toEqual(execution.records);
    expect(executions).toEqual([execution]);
    expect(executions[0]).toBe(execution);
  });

  it('tags every run with its own execution id', async () => {
    const { observer, started } = recorder();
    let next = 0;
    const engine = new WorkflowEngine(linear(), catalog, { observer, createExecutionId: () => `exec-${++next}` });
    await engine.run();
    await engine.run({ triggerId: 'start', targetNodeId: 'a' });
    expect(started.map(({ executionId, triggerId, targetNodeId }) => ({ executionId, triggerId, targetNodeId }))).toEqual([
      { executionId: 'exec-1', triggerId: undefined, targetNodeId: undefined },
      { executionId: 'exec-2', triggerId: 'start', targetNodeId: 'a' },
    ]);
  });

  it('hears nothing about nodes that do not run', async () => {
    const { observer, events } = recorder();
    await new WorkflowEngine(workflow(
      [{ id: 'start', pluginId: 'start' }, { id: 'if', pluginId: 'branch', parameters: { take: 'false' } }, { id: 'yes', pluginId: 'emit' }, { id: 'no', pluginId: 'emit' }],
      [['start', 'if'], ['if', 'yes', 'true'], ['if', 'no', 'false']],
    ), catalog, { observer, createExecutionId: () => 'x' }).run();
    expect(events.filter((event) => event.includes(':yes:'))).toEqual([]);
    expect(events.filter((event) => event.includes(':no:'))).toEqual(['start:no:x', 'finish:no:x']);
  });

  it('closes a trigger that lost its race without a record, as the run leaves it out', async () => {
    const { observer, finished } = recorder();
    const racing = defineNode({
      parseParameters: (parameters) => ({ fires: parameters.boolean('fires', false) }),
      createHandler: () => ({
        execute: ({ parameters, context }) => parameters.fires
          ? NodeOutput.main('fired')
          : new Promise<NodeOutput>((_resolve, reject) => context.signal.addEventListener('abort', () => reject(new Error('cancelled')))),
      }),
    });
    const execution = await new WorkflowEngine(
      workflow([{ id: 'fires', pluginId: 'start', parameters: { fires: true } }, { id: 'waits', pluginId: 'start' }], []),
      new StaticNodeCatalog({ start: racing }),
      { observer },
    ).run();
    expect(execution.record('waits')).toBeUndefined();
    expect(finished.find((event) => event.nodeId === 'waits')).toEqual({ executionId: expect.any(String), nodeId: 'waits' });
    expect(finished.find((event) => event.nodeId === 'fires')?.record).toEqual(execution.record('fires'));
  });

  it('never lets an observer change or fail a run, and logs what it throws or rejects', async () => {
    const logger: Logger = { info: vi.fn(), error: vi.fn() };
    const throwing: ExecutionObserver = {
      runStarted: () => { throw new Error('sync'); },
      nodeStarted: () => Promise.reject(new Error('async')),
      nodeFinished: () => { throw new Error('sync'); },
      runFinished: () => Promise.reject(new Error('async')),
    };
    const observed = await new WorkflowEngine(linear(), catalog, { observer: throwing, services: { logger } }).run({ payload: { id: 1 } });
    const plain = await new WorkflowEngine(linear(), catalog).run({ payload: { id: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(observed.toResponse()).toEqual(plain.toResponse());
    expect(observed.status).toBe('success');
    // runStarted + runFinished once, nodeStarted + nodeFinished for each of the three nodes.
    expect(logger.error).toHaveBeenCalledTimes(8);
    expect(logger.error).toHaveBeenCalledWith('[RunFlux] Execution observer failed in runStarted:', expect.any(Error));
    expect(logger.error).toHaveBeenCalledWith('[RunFlux] Execution observer failed in nodeStarted:', expect.any(Error));
  });

  it('creates no execution id when there is no observer', async () => {
    const createExecutionId = vi.fn(() => 'unused');
    await new WorkflowEngine(linear(), catalog, { createExecutionId }).run();
    expect(createExecutionId).not.toHaveBeenCalled();
  });
});
