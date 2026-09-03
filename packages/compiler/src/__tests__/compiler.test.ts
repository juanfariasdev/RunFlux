import { describe, it, expect } from 'vitest';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import type { CompiledPlugin } from '../types.js';
import { compileWorkflow } from '../compiler.js';

describe('compileWorkflow Engine', () => {
  const dummyTrigger: CompiledPlugin = {
    manifest: {
      id: 'trigger-manual-example',
      name: 'Trigger Manual',
      version: '1.0.0',
      category: 'trigger',
      parameters: [],
      supportedPlatforms: ['local', 'aws'],
    },
    generators: {
      local: () => ({
        files: [
          {
            path: 'src/nodes/trigger.ts',
            content: 'export async function run() { return { start: true }; }',
          },
        ],
        infra: [],
      }),
      aws: () => ({
        files: [
          {
            path: 'src/nodes/trigger.ts',
            content: 'export async function run() { return { start: true }; }',
          },
        ],
        infra: [],
      }),
    },
  };

  const dummySet: CompiledPlugin = {
    manifest: {
      id: 'set',
      name: 'Set Field',
      version: '1.0.0',
      category: 'action',
      parameters: [],
      supportedPlatforms: ['local', 'aws'],
    },
    generators: {
      local: () => ({
        files: [
          {
            path: 'src/nodes/set.ts',
            content: 'export async function run(input: any) { return { ...input, ok: true }; }',
          },
        ],
        infra: [],
      }),
      aws: () => ({
        files: [
          {
            path: 'src/nodes/set.ts',
            content: 'export async function run(input: any) { return { ...input, ok: true }; }',
          },
        ],
        infra: [],
      }),
    },
  };

  const resolver = (pluginId: string): CompiledPlugin | undefined => {
    if (pluginId === 'trigger-manual-example') return dummyTrigger;
    if (pluginId === 'set') return dummySet;
    return undefined;
  };

  const workflow: WorkflowDefinition = {
    id: 'wf-compile-test',
    name: 'Compilation Test Workflow',
    nodes: [
      {
        id: 'n1',
        pluginId: 'trigger-manual-example',
        pluginVersion: '1.0.0',
        parameters: {},
        position: { x: 0, y: 0 },
      },
      {
        id: 'n2',
        pluginId: 'set',
        pluginVersion: '1.0.0',
        parameters: {},
        position: { x: 100, y: 0 },
      },
    ],
    connections: [
      {
        sourceNodeId: 'n1',
        sourceOutput: 'main',
        targetNodeId: 'n2',
        targetInput: 'main',
      },
    ],
  };

  it('successfully compiles for target local producing manifest and zip', async () => {
    const result = await compileWorkflow(
      {
        workflow,
        targetPlatform: 'local',
        projectName: 'Compilation Test Workflow',
        projectVersion: 'v1',
      },
      resolver
    );

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.targetPlatform).toBe('local');
      expect(result.files.map((f) => f.path)).toContain('runflux-build.json');
      expect(result.files.map((f) => f.path)).toContain('src/server.ts');
      expect(result.manifest.pluginVersions['set']).toBe('1.0.0');
      expect(result.zipBuffer).toBeDefined();
      expect(result.zipBuffer!.length).toBeGreaterThan(100);
    }
  });

  it('successfully compiles for target aws producing CDK stack and zip', async () => {
    const result = await compileWorkflow(
      {
        workflow,
        targetPlatform: 'aws',
        projectName: 'AWS Test Workflow',
        projectVersion: 'v1',
      },
      resolver
    );

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.targetPlatform).toBe('aws');
      expect(result.files.map((f) => f.path)).toContain('lib/workflow-stack.ts');
      expect(result.files.map((f) => f.path)).toContain('src/handler.ts');
      expect(result.zipBuffer).toBeDefined();
    }
  });
});
