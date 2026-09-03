import { describe, it, expect } from 'vitest';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import type { CompiledPlugin } from '../types.js';
import { validateWorkflowCompatibility, getTopologicalNodeOrder } from '../validator.js';

describe('Compiler Validator', () => {
  const dummyLocalPlugin: CompiledPlugin = {
    manifest: {
      id: 'local-plugin',
      name: 'Local Only Plugin',
      version: '1.0.0',
      category: 'action',
      parameters: [],
      supportedPlatforms: ['local'],
    },
    generators: {
      local: () => ({
        files: [
          {
            path: 'src/nodes/local.ts',
            content: 'export const run = () => {};',
          },
        ],
        infra: [],
      }),
    },
  };

  const dummyUniversalPlugin: CompiledPlugin = {
    manifest: {
      id: 'universal-plugin',
      name: 'Universal Plugin',
      version: '1.0.0',
      category: 'action',
      parameters: [],
      supportedPlatforms: ['local', 'aws'],
    },
    generators: {
      local: () => ({ files: [{ path: 'src/nodes/univ.ts', content: '' }], infra: [] }),
      aws: () => ({ files: [{ path: 'src/nodes/univ-aws.ts', content: '' }], infra: [] }),
    },
  };

  const resolver = (pluginId: string): CompiledPlugin | undefined => {
    if (pluginId === 'local-plugin') return dummyLocalPlugin;
    if (pluginId === 'universal-plugin') return dummyUniversalPlugin;
    return undefined;
  };

  it('passes compatibility when all nodes support the target platform', () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-1',
      name: 'Fluxo Universal',
      nodes: [
        {
          id: 'n1',
          pluginId: 'universal-plugin',
          pluginVersion: '1.0.0',
          parameters: {},
          position: { x: 0, y: 0 },
        },
      ],
      connections: [],
    };

    const result = validateWorkflowCompatibility(workflow, 'aws', resolver);
    expect(result.compatible).toBe(true);
    expect(result.incompatibleNodes).toHaveLength(0);
  });

  it('fails fast when a node does not support the target platform', () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-2',
      name: 'Fluxo Incompatível',
      nodes: [
        {
          id: 'n1',
          pluginId: 'universal-plugin',
          pluginVersion: '1.0.0',
          parameters: {},
          position: { x: 0, y: 0 },
        },
        {
          id: 'n2',
          pluginId: 'local-plugin',
          pluginVersion: '1.0.0',
          parameters: {},
          position: { x: 100, y: 0 },
        },
      ],
      connections: [],
    };

    const result = validateWorkflowCompatibility(workflow, 'aws', resolver);
    expect(result.compatible).toBe(false);
    expect(result.incompatibleNodes).toEqual([
      {
        nodeId: 'n2',
        pluginId: 'local-plugin',
        targetPlatform: 'aws',
      },
    ]);
  });

  it('orders nodes in topological sequence according to connections', () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-dag',
      name: 'DAG Workflow',
      nodes: [
        {
          id: 'node-c',
          pluginId: 'universal-plugin',
          pluginVersion: '1.0.0',
          parameters: {},
          position: { x: 200, y: 0 },
        },
        {
          id: 'node-a',
          pluginId: 'universal-plugin',
          pluginVersion: '1.0.0',
          parameters: {},
          position: { x: 0, y: 0 },
        },
        {
          id: 'node-b',
          pluginId: 'universal-plugin',
          pluginVersion: '1.0.0',
          parameters: {},
          position: { x: 100, y: 0 },
        },
      ],
      connections: [
        {
          sourceNodeId: 'node-a',
          sourceOutput: 'main',
          targetNodeId: 'node-b',
          targetInput: 'main',
        },
        {
          sourceNodeId: 'node-b',
          sourceOutput: 'main',
          targetNodeId: 'node-c',
          targetInput: 'main',
        },
      ],
    };

    const orderedNodes = getTopologicalNodeOrder(workflow);
    expect(orderedNodes.map((n) => n.id)).toEqual(['node-a', 'node-b', 'node-c']);
  });
});
