import { describe, expect, it } from 'vitest';
import { DeploymentPlanner } from '../deployment/deployment-plan.js';
import { CompilationError } from '../types.js';
import { fixturePlugins, resolveFixture } from './fixtures/plugins.js';
import { edge, node, workflow } from './fixtures/workflows.js';

const planner = new DeploymentPlanner(resolveFixture);

describe('DeploymentPlanner', () => {
  it('binds each trigger contribution to its node', () => {
    const plan = planner.plan(workflow([
      node('orders', 'webhook', { path: '/orders', secret: 'ORDERS_KEY' }),
      node('events', 'webhook', { path: '/events' }),
      node('hourly', 'schedule'),
    ]));
    expect(plan.workflow.triggers).toEqual({
      http: [
        { nodeId: 'orders', path: '/orders', method: 'POST', rawBody: false, authentication: { type: 'header', headerName: 'X-Key', secretEnvVar: 'ORDERS_KEY' } },
        { nodeId: 'events', path: '/events', method: 'POST', rawBody: false, authentication: { type: 'none' } },
      ],
      schedules: [{ nodeId: 'hourly', expression: '0 * * * *', timezone: 'UTC' }],
    });
  });

  it('builds the executable document with literal parameters and outputs from the manifests', () => {
    const plan = planner.plan(workflow([node('hook', 'webhook'), node('save', 'store', { sql: 'SELECT {{ x }}' }), node('if', 'branch')], [edge('hook', 'save'), edge('save', 'if')]));
    expect(plan.workflow.nodes.map(({ id, trigger, outputs, literalParameters }) => ({ id, trigger, outputs, literalParameters }))).toEqual([
      { id: 'hook', trigger: true, outputs: ['main'], literalParameters: [] },
      { id: 'save', trigger: false, outputs: ['main'], literalParameters: ['sql'] },
      { id: 'if', trigger: false, outputs: ['yes', 'no'], literalParameters: [] },
    ]);
    expect(plan.workflow.connections).toHaveLength(2);
  });

  it('merges environment variables, letting the workflow settings win, and the options replace the settings', () => {
    const definition = workflow([node('hook', 'webhook', { secret: 'KEY' }), node('save', 'store')], [], {
      settings: { envVars: [{ key: 'KEY', value: 'configured' }, { key: 'EXTRA', description: 'Extra' }] },
    });
    expect(planner.plan(definition).environment).toEqual([
      { key: 'KEY', value: 'configured' },
      { key: 'STORE_URL', description: 'Store connection' },
      { key: 'EXTRA', description: 'Extra' },
    ]);
    expect(planner.plan(definition, { envVars: [{ key: 'ONLY', value: '1' }] }).environment.map((variable) => variable.key)).toEqual(['KEY', 'STORE_URL', 'ONLY']);
  });

  it('collects dependencies, compose services and the plugins to bundle once per plugin', () => {
    const plan = planner.plan(workflow([node('a', 'store'), node('b', 'store'), node('c', 'echo')]));
    expect(plan.dependencies).toEqual({ 'fixture-driver': '^1.0.0' });
    expect(plan.devDependencies).toEqual({ '@types/fixture-driver': '^1.0.0' });
    expect(Object.keys(plan.composeServices)).toEqual(['store']);
    expect(plan.composeVolumes).toEqual(['data']);
    expect(plan.plugins).toEqual([{ id: 'store', runtimeModule: fixturePlugins.store.runtimeModule }, { id: 'echo', runtimeModule: fixturePlugins.echo.runtimeModule }]);
    expect(plan.pluginVersions).toEqual({ store: '1.0.0', echo: '1.0.0' });
  });

  it.each([
    [[node('a', 'webhook'), node('b', 'webhook')], 'Webhooks "a" and "b" both answer POST /hook'],
    [[node('a', 'webhook', { path: '/same/' }), node('b', 'webhook', { path: '/same' })], 'Webhooks "a" and "b" both answer POST /same'],
  ])('rejects webhooks answering the same requests', (nodes, message) => {
    expect(() => planner.plan(workflow(nodes))).toThrow(message);
  });

  it('reports invalid trigger configuration with its node and missing plugins', () => {
    expect(() => planner.plan(workflow([node('bad', 'failingDeployment')]))).toThrow(new CompilationError('INVALID_WORKFLOW', 'Node "bad": failingDeployment: parameter "path" is not valid'));
    expect(() => planner.plan(workflow([node('x', 'absent')]))).toThrow('Plugin "absent" is not installed');
  });
});
