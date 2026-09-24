import { describe, it, expect } from 'vitest';
import { compileWorkflow } from '../compiler.js';
import { executeWorkflowGraph } from '../generators/templates/runner-template.js';
import type { PluginResolver, CompiledPlugin } from '../types.js';
import type { WorkflowDefinition } from '@runflux/workflow-model/types';

const mockPluginsContext: Record<string, CompiledPlugin> = {
  'trigger-manual-example': {
    manifest: {
      id: 'trigger-manual-example',
      name: 'Manual Trigger',
      category: 'trigger',
      version: '1.0.0',
      parameters: [],
      supportedPlatforms: ['local', 'aws'],
    },
    generators: {
      local: () => ({
        files: [
          {
            path: 'src/nodes/node-1-trigger.ts',
            content: `export async function run(input: any) { return input || { customerId: 'cust-100', name: 'Alice' }; }`,
          },
        ],
        infra: [],
      }),
    },
  },
  'set': {
    manifest: {
      id: 'set',
      name: 'Set',
      category: 'action',
      version: '1.0.0',
      parameters: [],
      supportedPlatforms: ['local', 'aws'],
    },
    generators: {
      local: () => ({
        files: [
          {
            path: 'src/nodes/node-2-set.ts',
            content: `export async function run(input: any, context?: any) {
              const customer = context?.$node?.['Trigger Node']?.json?.name || 'unknown';
              return { ...input, greeting: 'Hello ' + customer };
            }`,
          },
        ],
        infra: [],
      }),
    },
  },
};

const resolver: PluginResolver = (id: string) => mockPluginsContext[id];

describe('compiler-node-context: $node in compiled backends (009-expression-global-context)', () => {
  it('emits a runner that populates nodeScope and provides $node to node executions', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf-node-context',
      name: 'Node Context Workflow',
      nodes: [
        {
          id: 'node-trigger',
          pluginId: 'trigger-manual-example',
          pluginVersion: '1.0.0',
          parameters: {},
          position: { x: 0, y: 0 },
          appearance: { label: 'Trigger Node' },
        },
        {
          id: 'node-action',
          pluginId: 'set',
          pluginVersion: '1.0.0',
          parameters: {},
          position: { x: 100, y: 0 },
          appearance: { label: 'Action Node' },
        },
      ],
      connections: [
        { sourceNodeId: 'node-trigger', sourceOutput: 'main', targetNodeId: 'node-action', targetInput: 'main' },
      ],
    };

    const compilation = await compileWorkflow(
      {
        workflow: wf,
        targetPlatform: 'local',
        projectName: 'Context Test App',
      },
      resolver
    );

    expect(compilation.status).toBe('success');
    if (compilation.status !== 'success') return;

    const runner = compilation.files.find((f) => f.path === 'src/runner.ts');
    expect(runner).toBeDefined();
    expect(runner?.content).toContain('$node: nodeScope');
    expect(runner?.content).toContain('nodeScope[nodeId] = entry');
    expect(runner?.content).toContain('nodeScope[node.name] = entry');
  });

  it('successfully executes executeWorkflowGraph resolving $node from earlier nodes', async () => {
    const nodes = [
      {
        id: 'node-1',
        name: 'Webhook Event',
        isTrigger: true,
        run: async () => ({ userId: 'usr-42', plan: 'enterprise' }),
      },
      {
        id: 'node-2',
        name: 'Compute Step',
        isTrigger: false,
        run: async (input: any) => ({ ...input, calculated: 500 }),
      },
      {
        id: 'node-3',
        name: 'Final Action',
        isTrigger: false,
        run: async (_input: any, context?: any) => {
          const webhookData = context?.$node?.['Webhook Event']?.json;
          return {
            recipient: webhookData?.userId,
            isEnterprise: webhookData?.plan === 'enterprise',
          };
        },
      },
    ];

    const connections = [
      { source: 'node-1', sourceOutput: 'main', target: 'node-2', targetInput: 'main' },
      { source: 'node-2', sourceOutput: 'main', target: 'node-3', targetInput: 'main' },
    ];

    const result = await executeWorkflowGraph(nodes, connections);

    expect(result.success).toBe(true);
    expect(result.result).toEqual({
      recipient: 'usr-42',
      isEnterprise: true,
    });
  });
});
