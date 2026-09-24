import { describe, expect, it } from 'vitest';
import { generators } from '../index';

const testWorkflowContext = { workflowId: 'wf-1', nodeId: 'n1' };

describe('code-javascript generators (010-code-node-plugin)', () => {
  it('generates a TypeScript runner file for local platform encapsulating user code', () => {
    const code = `
      const doubled = $json.val * 2;
      return { doubled };
    `;
    const artifact = generators.local({ code }, testWorkflowContext);

    expect(artifact.files).toHaveLength(1);
    const file = artifact.files[0];
    expect(file.path).toBe('code-javascript.ts');
    expect(file.content).toContain('export async function run($json: any, context?: any)');
    expect(file.content).toContain('const doubled = $json.val * 2;');
    expect(file.content).toContain('return { doubled };');
    expect(file.content).toContain('context?.$node');
    expect(file.content).toContain('context?.$env');
  });

  it('generates identical execution logic for AWS Lambda platform', () => {
    const code = `return { processed: true };`;
    const localArtifact = generators.local({ code }, testWorkflowContext);
    const awsArtifact = generators.aws({ code }, testWorkflowContext);

    expect(awsArtifact.files[0].content).toBe(localArtifact.files[0].content);
  });
});
