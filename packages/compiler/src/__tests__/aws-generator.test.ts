import { describe, it, expect } from 'vitest';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import { generateAwsProject } from '../generators/aws.js';
import type { GeneratedFile } from '../types.js';

describe('AWS Target Generator', () => {
  const sampleWorkflow: WorkflowDefinition = {
    id: 'wf-aws-test',
    name: 'Backend AWS Lambda',
    nodes: [
      {
        id: 'node-trigger',
        pluginId: 'trigger-manual-example',
        pluginVersion: '1.0.0',
        parameters: {},
        position: { x: 0, y: 0 },
      },
      {
        id: 'node-set',
        pluginId: 'set',
        pluginVersion: '1.0.0',
        parameters: { fields: [{ name: 'msg', value: 'hello aws' }] },
        position: { x: 100, y: 0 },
      },
    ],
    connections: [
      {
        sourceNodeId: 'node-trigger',
        sourceOutput: 'main',
        targetNodeId: 'node-set',
        targetInput: 'main',
      },
    ],
  };

  const nodeFiles: GeneratedFile[] = [
    {
      path: 'src/nodes/node-trigger.ts',
      content: 'export async function executeTrigger() { return { ok: true }; }',
      type: 'source',
    },
    {
      path: 'src/nodes/node-set.ts',
      content: 'export async function executeSet(input: any) { return { ...input, msg: "hello aws" }; }',
      type: 'source',
    },
  ];

  it('generates an AWS Lambda + CDK project scaffold', () => {
    const files = generateAwsProject({
      workflow: sampleWorkflow,
      projectName: 'Backend AWS Lambda',
      nodeFiles,
      options: {},
    });

    const filePaths = files.map((f) => f.path);
    expect(filePaths).toContain('package.json');
    expect(filePaths).toContain('tsconfig.json');
    expect(filePaths).toContain('cdk.json');
    expect(filePaths).toContain('bin/app.ts');
    expect(filePaths).toContain('lib/workflow-stack.ts');
    expect(filePaths).toContain('src/handler.ts');
    expect(filePaths).toContain('src/nodes/node-trigger.ts');

    const handlerFile = files.find((f) => f.path === 'src/handler.ts')!;
    expect(handlerFile.content).toContain('export const handler = async');
    expect(handlerFile.content).toContain('statusCode: 200');

    const stackFile = files.find((f) => f.path === 'lib/workflow-stack.ts')!;
    expect(stackFile.content).toContain('class WorkflowStack extends Stack');
    expect(stackFile.content).toContain('lambda.Function');
  });
});
