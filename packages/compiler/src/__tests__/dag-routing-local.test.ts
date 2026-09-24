import { describe, it, expect } from 'vitest';
import { compileWorkflow } from '../compiler.js';
import { branchingWorkflowFixture } from './fixtures/branching-workflow.js';
import type { PluginResolver, CompiledPlugin } from '../types.js';

// Mock plugins matching the fixture nodes
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
            path: 'src/nodes/node-1-trigger-manual-example.ts',
            content: `export async function run(input: any) { return input || {}; }`,
          },
        ],
        infra: [],
      }),
    },
  },
  'condition-if': {
    manifest: {
      id: 'condition-if',
      name: 'If Condition',
      category: 'control-flow',
      version: '1.0.0',
      parameters: [],
      supportedPlatforms: ['local', 'aws'],
      outputs: ['true', 'false'],
    },
    generators: {
      local: () => ({
        files: [
          {
            path: 'src/nodes/node-2-condition-if.ts',
            content: `export async function run($json: any) {
              const matched = Number($json?.score) > 50;
              return { value: $json, activeOutput: matched ? 'true' : 'false' };
            }`,
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
      local: (params) => {
        const fields = (params.fields as Array<{ name: string; value: string }>) || [];
        const isApproved = fields.some((f) => f.value === 'APPROVED');
        const decision = isApproved ? 'APPROVED' : 'REJECTED';
        const fileName = isApproved ? 'node-3-set-approved.ts' : 'node-4-set-rejected.ts';
        return {
          files: [
            {
              path: `src/nodes/${fileName}`,
              content: `export async function run($json: any) {
                return { ...$json, decision: '${decision}' };
              }`,
            },
          ],
          infra: [],
        };
      },
    },
  },
};

const resolver: PluginResolver = (id: string) => mockPlugins[id];

describe('DAG Routing Local Compilation', () => {
  it('compiles workflow with DAG runner and connection metadata', async () => {
    const result = await compileWorkflow(
      {
        workflow: branchingWorkflowFixture,
        targetPlatform: 'local',
        projectName: 'Branching Test',
      },
      resolver
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    const filePaths = result.files.map((f) => f.path);
    expect(filePaths).toContain('src/runner.ts');
    expect(filePaths).toContain('src/server.ts');
    expect(filePaths).toContain('src/run.ts');

    const runnerFile = result.files.find((f) => f.path === 'src/runner.ts');
    expect(runnerFile).toBeDefined();
    // Runner must reference connections table and dispatch based on activeOutput
    expect(runnerFile?.content).toContain('connections');
    expect(runnerFile?.content).toContain('activeOutput');
  });
});
