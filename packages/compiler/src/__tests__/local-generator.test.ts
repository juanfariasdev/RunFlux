import { describe, it, expect } from 'vitest';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import { generateLocalProject } from '../generators/local.js';
import type { GeneratedFile } from '../types.js';

describe('Local Target Generator', () => {
  const sampleWorkflow: WorkflowDefinition = {
    id: 'wf-local-test',
    name: 'Backend de Teste Local',
    nodes: [
      {
        id: 'node-trigger',
        pluginId: 'trigger-manual-example',
        pluginVersion: '1.0.0',
        parameters: {},
        position: { x: 0, y: 0 },
      },
      {
        id: 'node-log',
        pluginId: 'log-output',
        pluginVersion: '1.0.0',
        parameters: { message: 'Executado com sucesso' },
        position: { x: 100, y: 0 },
      },
    ],
    connections: [
      {
        sourceNodeId: 'node-trigger',
        sourceOutput: 'main',
        targetNodeId: 'node-log',
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
      path: 'src/nodes/node-log.ts',
      content: 'export async function executeLog(input: any) { console.log(input); return input; }',
      type: 'source',
    },
  ];

  it('generates a full runnable local project scaffold', () => {
    const files = generateLocalProject({
      workflow: sampleWorkflow,
      projectName: 'Backend de Teste Local',
      nodeFiles,
      options: { port: 3000 },
    });

    const filePaths = files.map((f) => f.path);
    expect(filePaths).toContain('package.json');
    expect(filePaths).toContain('tsconfig.json');
    expect(filePaths).toContain('Dockerfile');
    expect(filePaths).toContain('.env.example');
    expect(filePaths).toContain('src/server.ts');
    expect(filePaths).toContain('src/nodes/node-trigger.ts');
    expect(filePaths).toContain('src/nodes/node-log.ts');

    const pkgFile = files.find((f) => f.path === 'package.json')!;
    const pkgJson = JSON.parse(pkgFile.content);
    expect(pkgJson.name).toBe('backend-de-teste-local');
    expect(pkgJson.scripts.build).toBe('tsc');
    expect(pkgJson.scripts.start).toBe('node dist/server.js');
    expect(pkgJson.dependencies).toHaveProperty('express');
    expect(pkgJson.dependencies).toHaveProperty('cors');

    const serverFile = files.find((f) => f.path === 'src/server.ts')!;
    expect(serverFile.content).toContain('express');
    expect(serverFile.content).toContain('app.post(');
    expect(serverFile.content).toContain('3000');
  });
});
