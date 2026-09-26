import { describe, expect, it } from 'vitest';
import { isEnvironmentVariableName } from '../../environment.js';
import { isHttpHeaderName, parseWebhookChannel, webhookChannel } from '../triggers.js';
import { parseExecutableWorkflow, WorkflowDocumentError, type ExecutableWorkflow } from '../executable-workflow.js';
import { ExecutableWorkflowBuilder, type NodeTypeDescription } from '../workflow-builder.js';
import { CyclicWorkflowError, UnknownNodeError, WorkflowGraph } from '../workflow-graph.js';

const types: Record<string, NodeTypeDescription> = {
  webhook: { category: 'trigger', parameters: [] },
  code: { category: 'action', parameters: [{ name: 'code', expressions: false }, { name: 'label' }] },
  branch: { category: 'control-flow', outputs: ['true', 'false'], parameters: [] },
};
const builder = new ExecutableWorkflowBuilder((pluginId) => types[pluginId]);

const document: ExecutableWorkflow = builder.build({
  id: 'orders',
  name: 'Orders',
  nodes: [
    { id: 'hook', pluginId: 'webhook' },
    { id: 'check', pluginId: 'branch', appearance: { label: 'Check' } },
    { id: 'run', pluginId: 'code', parameters: { code: 'return 1;' } },
    { id: 'mystery', pluginId: 'not-installed', appearance: {} },
  ],
  connections: [
    { sourceNodeId: 'hook', targetNodeId: 'check' },
    { sourceNodeId: 'check', sourceOutput: 'true', targetNodeId: 'run', targetInput: 'main' },
    { sourceNodeId: 'check', sourceOutput: 'true', targetNodeId: 'deleted-node' },
  ],
}, { http: [{ nodeId: 'hook', path: '/orders', method: 'POST', authentication: { type: 'header', headerName: 'X-Key', secretEnvVar: 'KEY' }, rawBody: false }], schedules: [] });

describe('ExecutableWorkflowBuilder', () => {
  it('describes each node with its plugin category, outputs, label and literal parameters', () => {
    expect(document.nodes).toEqual([
      { id: 'hook', pluginId: 'webhook', trigger: true, outputs: ['main'], parameters: {}, literalParameters: [] },
      { id: 'check', label: 'Check', pluginId: 'branch', trigger: false, outputs: ['true', 'false'], parameters: {}, literalParameters: [] },
      { id: 'run', pluginId: 'code', trigger: false, outputs: ['main'], parameters: { code: 'return 1;' }, literalParameters: ['code'] },
      { id: 'mystery', pluginId: 'not-installed', trigger: false, outputs: ['main'], parameters: {}, literalParameters: [] },
    ]);
  });

  it('gives parameters a node does not set the default of its type, as copies', () => {
    const defaults: NodeTypeDescription = { category: 'action', parameters: [{ name: 'limit', default: 10 }, { name: 'tags', default: ['a'] }, { name: 'free' }] };
    const built = new ExecutableWorkflowBuilder(() => defaults).build({
      id: 'w', name: 'W', connections: [],
      nodes: [{ id: 'unset', pluginId: 'x' }, { id: 'set', pluginId: 'x', parameters: { limit: 0, tags: [] } }, { id: 'other', pluginId: 'x' }],
    });
    expect(built.nodes.map((node) => node.parameters)).toEqual([{ limit: 10, tags: ['a'] }, { limit: 0, tags: [] }, { limit: 10, tags: ['a'] }]);
    expect(built.nodes[0].parameters.tags).not.toBe(built.nodes[2].parameters.tags);
    expect(built.nodes[0].parameters.tags).not.toBe(defaults.parameters[1].default);
  });

  it('keeps parameters evaluated per element verbatim, for the node to resolve itself', () => {
    const mapper: NodeTypeDescription = { category: 'action', parameters: [{ name: 'fields', expressions: 'perElement' }, { name: 'mode' }] };
    const built = new ExecutableWorkflowBuilder(() => mapper).build({
      id: 'w', name: 'W', connections: [],
      nodes: [{ id: 'map', pluginId: 'map-fields', parameters: { fields: [{ name: 'b', value: '{{ $json.a }}' }], mode: 'fields' } }],
    });
    expect(built.nodes[0]).toMatchObject({ parameters: { fields: [{ name: 'b', value: '{{ $json.a }}' }] }, literalParameters: ['fields'] });
  });

  it('defaults connection ports to main and drops connections to missing nodes', () => {
    expect(document.connections).toEqual([
      { source: 'hook', sourceOutput: 'main', target: 'check', targetInput: 'main' },
      { source: 'check', sourceOutput: 'true', target: 'run', targetInput: 'main' },
    ]);
  });
});

describe('parseExecutableWorkflow', () => {
  it('accepts every document the builder produces, surviving a JSON round trip', () => {
    expect(parseExecutableWorkflow(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });

  it.each<[string, (value: Record<string, any>) => void, string]>([
    ['a newer schema', (value) => { value.schemaVersion = 2; }, 'unsupported schemaVersion 2'],
    ['a node without plugin', (value) => { delete value.nodes[0].pluginId; }, 'nodes[0].pluginId must be text'],
    ['non-boolean trigger flags', (value) => { value.nodes[1].trigger = 'yes'; }, 'nodes[1].trigger must be true or false'],
    ['a connection without target', (value) => { delete value.connections[0].target; }, 'connections[0].target must be text'],
    ['an unknown HTTP method', (value) => { value.triggers.http[0].method = 'FETCH'; }, 'triggers.http[0].method "FETCH" is not an HTTP method'],
    ['an unknown authentication', (value) => { value.triggers.http[0].authentication = { type: 'basic' }; }, 'authentication.type must be "none" or "header"'],
    ['missing schedules', (value) => { delete value.triggers.schedules; }, 'triggers.schedules must be a list'],
    ['a label that is not text', (value) => { value.nodes[1].label = 1; }, 'nodes[1].label must be text'],
    ['a node id used twice', (value) => { value.nodes[1].id = 'hook'; }, 'node id "hook" is used twice'],
    ['a connection to a missing node', (value) => { value.connections[0].target = 'ghost'; }, 'connection hook -> ghost refers to an unknown node'],
    ['a connection from an undeclared output', (value) => { value.connections[1].sourceOutput = 'maybe'; }, 'connection from "check" uses unknown output "maybe"'],
    ['a trigger bound to an action', (value) => { value.triggers.http[0].nodeId = 'run'; }, 'trigger "run" is not a trigger node of the workflow'],
    ['a header name with a space', (value) => { value.triggers.http[0].authentication.headerName = 'X Key'; }, 'triggers.http[0].authentication.headerName "X Key" is not an HTTP header name'],
    ['a secret variable name with a dash', (value) => { value.triggers.http[0].authentication.secretEnvVar = 'MY-KEY'; }, 'triggers.http[0].authentication.secretEnvVar "MY-KEY" is not an environment variable name'],
    ['an invalid cron expression', (value) => { value.triggers.schedules = [{ nodeId: 'hook', expression: '61 * * * *', timezone: 'UTC' }]; }, 'triggers.schedules[0].expression "61 * * * *" is not a five-field cron expression'],
    ['an unknown timezone', (value) => { value.triggers.schedules = [{ nodeId: 'hook', expression: '0 * * * *', timezone: 'Mars/Base' }]; }, 'triggers.schedules[0].timezone "Mars/Base" is not a known timezone'],
  ])('rejects %s', (_case, corrupt, message) => {
    const value = JSON.parse(JSON.stringify(document));
    corrupt(value);
    expect(() => parseExecutableWorkflow(value)).toThrow(WorkflowDocumentError);
    expect(() => parseExecutableWorkflow(value)).toThrow(message);
  });

  it.each([null, [], 'workflow'])('rejects %j as a document', (value) => {
    expect(() => parseExecutableWorkflow(value)).toThrow('Invalid workflow document: the document must be an object');
  });
});

describe('WorkflowGraph', () => {
  const graph = new WorkflowGraph(document);

  it('indexes nodes and their connections', () => {
    expect(graph.node('check').label).toBe('Check');
    expect(graph.incoming('run').map((connection) => connection.source)).toEqual(['check']);
    expect(graph.outgoing('hook').map((connection) => connection.target)).toEqual(['check']);
    expect(graph.incoming('hook')).toEqual([]);
    expect(() => graph.node('absent')).toThrow(UnknownNodeError);
  });

  it('lists triggers, optionally narrowed to one that must be a trigger', () => {
    expect(graph.triggers().map((node) => node.id)).toEqual(['hook']);
    expect(graph.triggers('hook').map((node) => node.id)).toEqual(['hook']);
    expect(() => graph.triggers('run')).toThrow('Node "run" is not a trigger');
    expect(() => graph.triggers('absent')).toThrow('Unknown node "absent" in workflow "orders"');
  });

  it('finds every node reachable from the start nodes', () => {
    expect([...graph.reachableFrom(['hook'])]).toEqual(['hook', 'check', 'run']);
    expect([...graph.reachableFrom([])]).toEqual([]);
  });

  it('rejects cycles, including self loops', () => {
    const cyclic = { ...document, connections: [...document.connections, { source: 'run', sourceOutput: 'main', target: 'check', targetInput: 'main' }] };
    expect(() => new WorkflowGraph(cyclic)).toThrow(CyclicWorkflowError);
    const selfLoop = { ...document, connections: [{ source: 'run', sourceOutput: 'main', target: 'run', targetInput: 'main' }] };
    expect(() => new WorkflowGraph(selfLoop)).toThrow(CyclicWorkflowError);
  });
});

describe('webhook channels', () => {
  it('names a route by method and normalized path, and reads it back', () => {
    expect(webhookChannel({ method: 'POST', path: 'orders//' })).toBe('POST /orders');
    expect(parseWebhookChannel('POST /orders')).toEqual({ method: 'POST', path: '/orders' });
    expect(parseWebhookChannel('ANY /')).toEqual({ method: 'ANY', path: '/' });
  });

  it('reads a bare path as a route for any method', () => {
    expect(parseWebhookChannel('/orders/')).toEqual({ method: 'ANY', path: '/orders' });
    expect(parseWebhookChannel('orders')).toEqual({ method: 'ANY', path: '/orders' });
  });
});

describe('isHttpHeaderName and isEnvironmentVariableName', () => {
  it.each([['X-Webhook-Secret', true], ['x_key.1', true], ['X Key', false], ['', false], ['X:Key', false], ['Ключ', false]])('header %j: %s', (name, valid) => {
    expect(isHttpHeaderName(name)).toBe(valid);
  });

  it.each([['DATABASE_URL', true], ['_private', true], ['a1', true], ['1A', false], ['MY-KEY', false], ['', false], ['A B', false]])('variable %j: %s', (name, valid) => {
    expect(isEnvironmentVariableName(name)).toBe(valid);
  });
});
