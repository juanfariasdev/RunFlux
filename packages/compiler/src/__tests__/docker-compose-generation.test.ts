import { describe, it, expect } from 'vitest';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import { generateLocalProject } from '../generators/local.js';
import type { GeneratedFile } from '../types.js';

describe('Docker & Docker Compose Generation', () => {
  const sampleWorkflow: WorkflowDefinition = {
    id: 'wf-docker-test',
    name: 'Docker Test Service',
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
        parameters: { message: 'Hello container' },
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

  const sampleDbWorkflow: WorkflowDefinition = {
    id: 'wf-docker-db-test',
    name: 'Docker DB Service',
    nodes: [
      {
        id: 'node-trigger',
        pluginId: 'trigger-manual-example',
        pluginVersion: '1.0.0',
        parameters: {},
        position: { x: 0, y: 0 },
      },
      {
        id: 'node-db',
        pluginId: 'database-query',
        pluginVersion: '1.0.0',
        parameters: {
          databaseType: 'postgres',
          query: 'SELECT * FROM users;',
        },
        position: { x: 100, y: 0 },
      },
    ],
    connections: [
      {
        sourceNodeId: 'node-trigger',
        sourceOutput: 'main',
        targetNodeId: 'node-db',
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
      content: 'export async function run(input: any) { return input; }',
      type: 'source',
    },
  ];

  it('generates a multi-stage Dockerfile adhering to production security standards', () => {
    const files = generateLocalProject({
      workflow: sampleWorkflow,
      projectName: 'Docker Test Service',
      nodeFiles,
      options: { port: 4000 },
    });

    const dockerfile = files.find((f) => f.path === 'Dockerfile');
    expect(dockerfile).toBeDefined();
    expect(dockerfile!.type).toBe('infrastructure');

    const content = dockerfile!.content;
    // Multi-stage builder & runner
    expect(content).toContain('AS builder');
    expect(content).toContain('AS runner');
    expect(content).toContain('node:20-alpine');
    // Dependencies & compilation
    expect(content).toContain('npm run build');
    expect(content).toContain('npm ci --omit=dev');
    // Non-root user
    expect(content).toContain('USER node');
    // Port exposure
    expect(content).toContain('EXPOSE 4000');
    // Healthcheck
    expect(content).toContain('HEALTHCHECK');
    expect(content).toContain('http://localhost:4000/health');
    // Entrypoint
    expect(content).toContain('CMD ["node", "dist/server.mjs"]');
  });

  it('generates docker-compose.yml for standalone workflows without database', () => {
    const files = generateLocalProject({
      workflow: sampleWorkflow,
      projectName: 'Docker Test Service',
      nodeFiles,
      options: { port: 3000 },
    });

    const composeFile = files.find((f) => f.path === 'docker-compose.yml');
    expect(composeFile).toBeDefined();
    expect(composeFile!.type).toBe('infrastructure');

    const content = composeFile!.content;
    expect(content).toContain('services:');
    expect(content).toContain('app:');
    expect(content).toContain('build: .');
    expect(content).toContain('restart: unless-stopped');
    expect(content).toContain('${PORT:-3000}:3000');
    expect(content).toContain('.env');
    // Does not include postgres service or volumes when no database is used
    expect(content).not.toContain('postgres:16-alpine');
    expect(content).not.toContain('volumes:\n  pgdata:');
  });

  it('generates docker-compose.yml with postgres service and volume when database-query is present', () => {
    const files = generateLocalProject({
      workflow: sampleDbWorkflow,
      projectName: 'Docker DB Service',
      nodeFiles,
      options: { port: 3000 },
    });

    const composeFile = files.find((f) => f.path === 'docker-compose.yml');
    expect(composeFile).toBeDefined();

    const content = composeFile!.content;
    expect(content).toContain('services:');
    expect(content).toContain('app:');
    expect(content).toContain('postgres:');
    expect(content).toContain('postgres:16-alpine');
    expect(content).toContain('POSTGRES_DB');
    expect(content).toContain('depends_on:');
    expect(content).toContain('postgres');
    expect(content).toContain('volumes:');
    expect(content).toContain('pgdata:');
  });

  it('adds docker convenience scripts in package.json and deployment guide in README.md', () => {
    const files = generateLocalProject({
      workflow: sampleWorkflow,
      projectName: 'Docker Test Service',
      nodeFiles,
      options: { port: 3000 },
    });

    const pkgFile = files.find((f) => f.path === 'package.json');
    const pkg = JSON.parse(pkgFile!.content);
    expect(pkg.scripts['docker:build']).toBe('docker build -t docker-test-service .');
    expect(pkg.scripts['docker:up']).toBe('docker compose up -d');
    expect(pkg.scripts['docker:down']).toBe('docker compose down');

    const readmeFile = files.find((f) => f.path === 'README.md');
    expect(readmeFile!.content).toContain('Docker & Container Deployment');
    expect(readmeFile!.content).toContain('npm run docker:up');
    expect(readmeFile!.content).toContain('docker compose up -d');
  });
});
