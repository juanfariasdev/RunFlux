import { describe, expect, it } from 'vitest';
import { CompilationError } from '../types.js';
import { WorkflowValidator } from '../validation/workflow-validator.js';
import { resolveFixture } from './fixtures/plugins.js';
import { edge, node, workflow } from './fixtures/workflows.js';

const validator = new WorkflowValidator(resolveFixture);

function failure(definition: Parameters<WorkflowValidator['validate']>[0], target: 'local' | 'aws' = 'local') {
  try {
    validator.validate(definition, target);
  } catch (error) {
    if (error instanceof CompilationError) return error.toFailure().error;
    throw error;
  }
  return undefined;
}

describe('WorkflowValidator', () => {
  it('accepts a valid workflow', () => {
    expect(failure(workflow([node('a', 'webhook'), node('b', 'branch'), node('c', 'echo')], [edge('a', 'b'), edge('b', 'c', 'yes')]))).toBeUndefined();
  });

  it('lists every node whose plugin is missing or does not support the target', () => {
    expect(failure(workflow([node('a', 'webhook'), node('b', 'localOnly'), node('c', 'absent')]), 'aws')).toEqual({
      code: 'INCOMPATIBLE_NODES',
      message: "Workflow contains 2 node(s) without support for target platform 'aws'.",
      details: { incompatibleNodes: [
        { nodeId: 'b', pluginId: 'localOnly', targetPlatform: 'aws' },
        { nodeId: 'c', pluginId: 'absent', targetPlatform: 'aws' },
      ] },
    });
    expect(failure(workflow([node('b', 'localOnly')]), 'local')).toBeUndefined();
  });

  it.each([
    ['duplicate node ids', workflow([node('same', 'echo'), node('same', 'echo')]), 'Duplicate or empty node ID "same"'],
    ['empty node ids', workflow([node('', 'echo')]), 'Duplicate or empty node ID ""'],
    ['connections from unknown nodes', workflow([node('a', 'echo')], [edge('missing', 'a')]), 'references an unknown node'],
    ['connections to unknown nodes', workflow([node('a', 'echo')], [edge('a', 'missing')]), 'references an unknown node'],
    ['unknown outputs', workflow([node('a', 'branch'), node('b', 'echo')], [edge('a', 'b', 'maybe')]), 'Unknown output "maybe" on node "a"'],
    ['main on a node with named outputs', workflow([node('a', 'branch'), node('b', 'echo')], [edge('a', 'b')]), 'Unknown output "main" on node "a"'],
  ])('rejects %s', (_case, definition, message) => {
    expect(failure(definition)).toMatchObject({ code: 'INVALID_WORKFLOW', message: expect.stringContaining(message) });
  });

  it('rejects cycles', () => {
    expect(failure(workflow([node('a', 'echo'), node('b', 'echo')], [edge('a', 'b'), edge('b', 'a')]))).toMatchObject({ code: 'CYCLE_DETECTED' });
  });
});
