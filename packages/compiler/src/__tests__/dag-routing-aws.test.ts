import { describe, it, expect } from 'vitest';
import { compileWorkflow } from '../compiler.js';
import { branchingWorkflowFixture } from './fixtures/branching-workflow.js';
import type { PluginResolver, CompiledPlugin } from '../types.js';

const mockPluginsAws: Record<string, CompiledPlugin> = {
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
      aws: () => ({
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
      aws: () => ({
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
      aws: (params) => {
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

const resolver: PluginResolver = (id: string) => mockPluginsAws[id];

describe('DAG Routing AWS Compilation', () => {
  it('compiles AWS project with DAG runner and connection metadata', async () => {
    const result = await compileWorkflow(
      {
        workflow: branchingWorkflowFixture,
        targetPlatform: 'aws',
        projectName: 'Branching AWS Stack',
      },
      resolver
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    const filePaths = result.files.map((f) => f.path);
    expect(filePaths).toContain('src/runner.ts');
    expect(filePaths).toContain('src/handler.ts');

    const runnerFile = result.files.find((f) => f.path === 'src/runner.ts');
    expect(runnerFile).toBeDefined();
    expect(runnerFile?.content).toContain('connections');
    expect(runnerFile?.content).toContain('activeOutput');
  });
});
