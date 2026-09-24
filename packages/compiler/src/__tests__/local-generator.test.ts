import { describe, it, expect } from 'vitest';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import { generateLocalProject } from '../generators/local.js';
import type { GeneratedFile } from '../types.js';

describe('Local Target Generator', () => {
  const sampleWorkflow: WorkflowDefinition = {
    id: 'wf-local-test',
    name: 'Local Test Backend',
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
        parameters: { message: 'Executed successfully' },
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
      content: 'export async function run() { return { ok: true }; }',
      type: 'source',
    },
    {
      path: 'src/nodes/node-log.ts',
      content: 'export async function run(input: any) { console.log(input); return input; }',
      type: 'source',
    },
  ];

  it('generates a full runnable local project scaffold', () => {
    const files = generateLocalProject({
      workflow: sampleWorkflow,
      projectName: 'Local Test Backend',
      nodeFiles,
      options: { port: 3000 },
    });

    const filePaths = files.map((f) => f.path);
    expect(filePaths).toContain('package.json');
    expect(filePaths).toContain('tsconfig.json');
    expect(filePaths).toContain('Dockerfile');
    expect(filePaths).toContain('.env.example');
    expect(filePaths).toContain('src/server.ts');
    expect(filePaths).toContain('src/run.ts');
    expect(filePaths).toContain('src/nodes/node-trigger.ts');
    expect(filePaths).toContain('src/nodes/node-log.ts');

    const pkgFile = files.find((f) => f.path === 'package.json')!;
    const pkgJson = JSON.parse(pkgFile.content);
    expect(pkgJson.name).toBe('local-test-backend');
    expect(pkgJson.scripts.build).toContain('esbuild');
    expect(pkgJson.scripts.package).toContain('zip -j compiled/function.zip dist/*');
    expect(pkgJson.scripts.start).toBe('node dist/server.mjs');
    expect(pkgJson.scripts.run).toBe('node dist/run.mjs');
    expect(pkgJson.dependencies).toHaveProperty('express');
    expect(pkgJson.dependencies).toHaveProperty('cors');
    expect(pkgJson.devDependencies).toHaveProperty('esbuild');

    const serverFile = files.find((f) => f.path === 'src/server.ts')!;
    const app = files.find((file) => file.path === 'src/app.ts')!;
    expect(app.content).toContain('express');
    expect(app.content).toContain('app.post(');
    expect(serverFile.content).toContain('3000');
  });

  it('generates .env.example with registered project environment variables (011-env-vars-secrets)', () => {
    const files = generateLocalProject({
      workflow: sampleWorkflow,
      projectName: 'Local Test Backend',
      nodeFiles,
      options: {
        port: 8080,
        envVars: [
          { key: 'STRIPE_SECRET_KEY', value: 'sk_test_demo', description: 'Stripe API private token' },
          { key: 'DATABASE_URL', value: 'postgres://user:pass@localhost:5432/app', description: 'Main database' },
        ],
      },
    });

    const envFile = files.find((f) => f.path === '.env.example')!;
    expect(envFile).toBeDefined();
    expect(envFile.content).toContain('PORT=8080');
    expect(envFile.content).toContain('# Project Environment Variables');
    expect(envFile.content).toContain('# Stripe API private token');
    expect(envFile.content).toContain('STRIPE_SECRET_KEY=sk_test_demo');
    expect(envFile.content).toContain('# Main database');
    expect(envFile.content).toContain('DATABASE_URL=postgres://user:pass@localhost:5432/app');
  });
});
