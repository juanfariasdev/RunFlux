import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ExpressHost } from '../express/express-host.js';
import type { RunRequest, WorkflowRunner } from '../../contracts/runner.js';
import { defineNode, NodeOutput } from '../../contracts/node.js';
import { StaticNodeCatalog } from '../../engine/node-catalog.js';
import { WorkflowEngine } from '../../engine/workflow-engine.js';
import { ExecutableWorkflowBuilder } from '../../workflow/workflow-builder.js';
import { hostEngine, httpTrigger } from './fixtures.js';

/**
 * Two guards that decide what an operator sees when something goes wrong, and that no test
 * exercised.
 *
 * Both exist for the same reason: a node or a host can fail with something that is not an Error,
 * and `error.message` on that is `undefined` — which would be recorded as a node error whose text
 * is literally "undefined", and shown in the run report and in the editor. Every test in the
 * repository threw real Errors, so the fallback never ran.
 */

// ---------------------------------------------------------------------------------------------
// The express host's own catch, at express-host.ts:103
// ---------------------------------------------------------------------------------------------

/** A runner whose `run` does whatever the test needs it to do. WorkflowEngine is one already. */
function runnerThat(run: (request: RunRequest) => Promise<never>): WorkflowRunner {
  const engine = hostEngine({ http: [httpTrigger('orders')] });
  return { workflow: engine.workflow, run };
}

// FINDING, 2026-10-16, recorded rather than asserted: express-host.ts:103 guards BOTH
// `!response.headersSent` and the stringification. Only the second is reachable from this host.
// The host is the sole writer of `response` and it writes only after `run()` resolves, so nothing
// can have sent a response before the catch fires — and an `app.use` added from outside lands
// AFTER the routes, so it cannot be used to force the branch either. The guard is defensive code
// for a host that streams, and it is left in place. There is no test for it because there is no
// path to it; a test that fabricated one would be testing the test.

describe('a runner that rejects (express-host.ts:103)', () => {
  it('answers 500 with the message of a real Error', async () => {
    const app = new ExpressHost(
      runnerThat(async () => {
        throw new Error('the plugin host vanished');
      }),
    ).app;
    const response = await request(app).post('/orders').send({});
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ success: false, error: 'the plugin host vanished' });
  });

  // FINDING, 2026-10-16: express-host.ts:103 — the `String(error)` half of
  // `error instanceof Error ? error.message : String(error)` was uncovered.
  it('answers 500 with the string of a rejection that is not an Error', async () => {
    const app = new ExpressHost(
      runnerThat(async () => {
        throw 'the host returned a bare string';
      }),
    ).app;
    const response = await request(app).post('/orders').send({});
    expect(response.status).toBe(500);
    // Without the fallback this would be the string "undefined".
    expect(response.body).toEqual({ success: false, error: 'the host returned a bare string' });
  });

  it('answers 500 with a readable form for every other non-Error rejection', async () => {
    for (const thrown of [{ code: 'ETIMEDOUT' }, 42, null, undefined]) {
      const app = new ExpressHost(
        runnerThat(async () => {
          throw thrown;
        }),
      ).app;
      const response = await request(app).post('/orders').send({}).timeout(2000);
      expect(response.status, String(thrown)).toBe(500);
      expect(response.body.success, String(thrown)).toBe(false);
      // Whatever the shape, the field is a string — never the literal "undefined".
      expect(typeof response.body.error, String(thrown)).toBe('string');
    }
  });

  it('does not let a rejection escape as an unhandled rejection', async () => {
    // The handler awaits run() inside a try, so the rejection is consumed. If the await were
    // missing, the request would hang and Node would report an unhandled rejection.
    const app = new ExpressHost(
      runnerThat(async () => {
        throw new Error('consumed here');
      }),
    ).app;
    const response = await request(app).post('/orders').send({}).timeout(2000);
    expect(response.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------------------------
// The node executor's own catch, at node-executor.ts:65
// ---------------------------------------------------------------------------------------------

/**
 * An engine whose single action node throws whatever the test hands it.
 *
 * Built here rather than through `hostEngine`, whose catalog only knows how to throw a real Error —
 * which is the exact gap being closed.
 */
function engineThatThrows(thrown: unknown): WorkflowEngine {
  const catalog = new StaticNodeCatalog({
    trigger: defineNode({ parseParameters: () => ({}), createHandler: () => ({ execute: ({ input }) => NodeOutput.main(input) }) }),
    thrower: defineNode({ parseParameters: () => ({}), createHandler: () => ({ execute: () => { throw thrown; } }) }),
  });
  const builder = new ExecutableWorkflowBuilder((pluginId) => ({ category: pluginId === 'trigger' ? 'trigger' : 'action', parameters: [] }));
  const trigger = httpTrigger('orders');
  return new WorkflowEngine(
    builder.build(
      {
        id: 'throwing',
        name: 'Throwing workflow',
        nodes: [
          { id: 'orders', pluginId: 'trigger' },
          { id: 'work', pluginId: 'thrower' },
        ],
        connections: [{ sourceNodeId: 'orders', targetNodeId: 'work' }],
      },
      { http: [trigger], schedules: [] },
    ),
    catalog,
  );
}

describe('a node that rejects (node-executor.ts:65)', () => {
  // FINDING, 2026-10-16: node-executor.ts:65 — the `String(error)` fallback was uncovered. The
  // message it produces is what lands on the node record, so a plugin rejecting with a plain
  // string would have been reported as `error: "undefined"`.
  const cases: ReadonlyArray<readonly [unknown, string]> = [
    ['a bare string', 'a bare string'],
    [{ code: 'EHOSTUNREACH' }, '[object Object]'],
    [42, '42'],
    [null, 'null'],
    [undefined, 'undefined'],
  ];

  for (const [thrown, expected] of cases) {
    it(`records "${expected}" for a rejection that is not an Error`, async () => {
      const execution = await engineThatThrows(thrown).run({ triggerId: 'orders', payload: {} });
      // outputs() lists only the nodes that SUCCEEDED, so a failing node is read with record().
      const record = execution.record('work');
      expect(record?.error).toBe(expected);
      expect(record?.output).toBeNull();
      expect(record?.activeOutput).toBeNull();
      expect(execution.succeeded).toBe(false);
      // The run report names the same text the node record does.
      expect(execution.error).toBe(expected);
      expect(execution.toResponse()).toMatchObject({ success: false, error: expected });
    });
  }

  it('records the message of a real Error unchanged', async () => {
    const execution = await engineThatThrows(new Error('the ordinary case')).run({ triggerId: 'orders', payload: {} });
    expect(execution.record('work')?.error).toBe('the ordinary case');
  });

  // The case the fallback does NOT help, and worth seeing rather than assuming.
  it('records an empty message rather than inventing one', async () => {
    const execution = await engineThatThrows(new Error('')).run({ triggerId: 'orders', payload: {} });
    expect(execution.record('work')?.error).toBe('');
  });

  it('does not stop the other nodes when one rejects with a non-Error', async () => {
    const catalog = new StaticNodeCatalog({
      trigger: defineNode({ parseParameters: () => ({}), createHandler: () => ({ execute: ({ input }) => NodeOutput.main(input) }) }),
      thrower: defineNode({ parseParameters: () => ({}), createHandler: () => ({ execute: () => { throw 'first failed'; } }) }),
      worker: defineNode({ parseParameters: () => ({}), createHandler: () => ({ execute: () => NodeOutput.main('ran anyway') }) }),
    });
    const builder = new ExecutableWorkflowBuilder((pluginId) => ({ category: pluginId === 'trigger' ? 'trigger' : 'action', parameters: [] }));
    const engine = new WorkflowEngine(
      builder.build(
        {
          id: 'branching',
          name: 'Branching workflow',
          nodes: [
            { id: 'orders', pluginId: 'trigger' },
            { id: 'work', pluginId: 'thrower' },
            { id: 'after', pluginId: 'worker' },
          ],
          connections: [
            { sourceNodeId: 'orders', targetNodeId: 'work' },
            { sourceNodeId: 'orders', targetNodeId: 'after' },
          ],
        },
        { http: [httpTrigger('orders')], schedules: [] },
      ),
      catalog,
    );
    const execution = await engine.run({ triggerId: 'orders', payload: {} });
    expect(execution.record('work')?.error).toBe('first failed');
    // outputs() carries only the node that succeeded, which is the point: one failure does not
    // erase the work the others did.
    expect(execution.outputs()).toMatchObject({ after: 'ran anyway' });
    expect(execution.outputs()).not.toHaveProperty('work');
  });
});