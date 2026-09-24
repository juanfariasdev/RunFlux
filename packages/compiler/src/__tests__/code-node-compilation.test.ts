import { describe, it, expect } from 'vitest';
import { compileWorkflow } from '../compiler.js';
import { executeWorkflowGraph } from '../generators/templates/runner-template.js';
import type { PluginResolver, CompiledPlugin } from '../types.js';
import type { WorkflowDefinition } from '@runflux/workflow-model/types';

const mockPlugins: Record<string, CompiledPlugin> = {
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
            content: `export async function run(input: any) { return input || { price: 50 }; }`,
          },
        ],
        infra: [],
      }),
      aws: () => ({
        files: [
          {
            path: 'src/nodes/node-1-trigger.ts',
            content: `export async function run(input: any) { return input || { price: 50 }; }`,
          },
        ],
        infra: [],
      }),
    },
  },
  'code-javascript': {
    manifest: {
      id: 'code-javascript',
      name: 'Custom JavaScript Code',
      category: 'action',
      version: '1.0.0',
      parameters: [{ name: 'code', label: 'JavaScript Code', type: 'string', required: true, default: 'return $json;' }],
      supportedPlatforms: ['local', 'aws'],
    },
    generators: {
      local: (params) => ({
        files: [
          {
            path: 'src/nodes/node-2-code-javascript.ts',
            content: `export async function run($json: any, context?: any) {\n  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;\n  const fn = new AsyncFunction('$json', '$node', '$env', ${JSON.stringify(params.code || 'return $json;')});\n  return await fn($json, context?.$node, context?.$env);\n}`,
          },
        ],
        infra: [],
      }),
      aws: (params) => ({
        files: [
          {
            path: 'src/nodes/node-2-code-javascript.ts',
            content: `export async function run($json: any, context?: any) {\n  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;\n  const fn = new AsyncFunction('$json', '$node', '$env', ${JSON.stringify(params.code || 'return $json;')});\n  return await fn($json, context?.$node, context?.$env);\n}`,
          },
        ],
        infra: [],
      }),
    },
  },
};

const resolver: PluginResolver = (id: string) => mockPlugins[id];

describe('code-node compilation (010-code-node-plugin)', () => {
  it('compiles workflow containing a code-javascript node to local backend', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf-code-node',
      name: 'Code Node Workflow',
      nodes: [
        {
          id: 'node-trigger',
          pluginId: 'trigger-manual-example',
          pluginVersion: '1.0.0',
          parameters: {},
          position: { x: 0, y: 0 },
          appearance: { label: 'Start' },
        },
        {
          id: 'node-code',
          pluginId: 'code-javascript',
          pluginVersion: '1.0.0',
          parameters: {
            code: 'return { calculated: $json.price * 3, processed: true };',
          },
          position: { x: 150, y: 0 },
          appearance: { label: 'Custom Transform' },
        },
      ],
      connections: [
        { sourceNodeId: 'node-trigger', sourceOutput: 'main', targetNodeId: 'node-code', targetInput: 'main' },
      ],
    };

    const result = await compileWorkflow(
      {
        workflow: wf,
        targetPlatform: 'local',
        projectName: 'Code Node App',
      },
      resolver
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    const codeFile = result.files.find((f) => f.path.includes('code-javascript.js'));
    expect(codeFile).toBeDefined();
    expect(codeFile?.content).toContain('calculated: $json.price * 3');
    expect(codeFile?.content).toContain('export async function run($json: any, context?: any)');

    const runnerFile = result.files.find((f) => f.path === 'src/runner.ts');
    expect(runnerFile).toBeDefined();
    expect(runnerFile?.content).toContain('node-code');
  });

  it('runs workflow with user-defined code logic in executeWorkflowGraph', async () => {
    const nodes = [
      {
        id: 'node-1',
        name: 'Trigger',
        isTrigger: true,
        run: async () => ({ rawItems: [10, 20, 30] }),
      },
      {
        id: 'node-2',
        name: 'JS Code',
        isTrigger: false,
        run: async ($json: any) => {
          const sum = $json.rawItems.reduce((a: number, b: number) => a + b, 0);
          return { sum, average: sum / $json.rawItems.length };
        },
      },
    ];

    const connections = [
      { source: 'node-1', sourceOutput: 'main', target: 'node-2', targetInput: 'main' },
    ];

    const execution = await executeWorkflowGraph(nodes, connections);
    expect(execution.success).toBe(true);
    expect(execution.result).toEqual({ sum: 60, average: 20 });
  });
});
