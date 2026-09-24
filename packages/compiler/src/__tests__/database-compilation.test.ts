import { loadGeneratedModule } from '@runflux/plugin-system/testing';
import { describe, it, expect } from 'vitest';
import { compileWorkflow } from '../compiler.js';
import type { PluginResolver, CompiledPlugin } from '../types.js';
import type { WorkflowDefinition } from '@runflux/workflow-model/types';

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
            path: 'src/nodes/node-1-trigger.ts',
            content: `export async function run(input: any) { return input || { customerId: 42 }; }`,
          },
        ],
        infra: [],
      }),
      aws: () => ({
        files: [
          {
            path: 'src/nodes/node-1-trigger.ts',
            content: `export async function run(input: any) { return input || { customerId: 42 }; }`,
          },
        ],
        infra: [],
      }),
    },
  },
  'database-query': {
    manifest: {
      id: 'database-query',
      name: 'Database Query',
      category: 'action',
      version: '1.0.0',
      parameters: [
        { name: 'query', label: 'SQL Query', type: 'string', required: true, default: 'SELECT 1;' },
      ],
      supportedPlatforms: ['local', 'aws'],
    },
    generators: {
      local: (params) => ({
        files: [
          {
            path: 'src/nodes/node-2-database-query.ts',
            content: `import pg from 'pg';\nexport async function run(input: any) {\n  return [{ id: 42, name: 'Alice' }];\n}`,
          },
        ],
        infra: [],
      }),
      aws: (params) => ({
        files: [
          {
            path: 'src/nodes/node-2-database-query.ts',
            content: `import pg from 'pg';\nexport async function run(input: any) {\n  return [{ id: 42, name: 'Alice' }];\n}`,
          },
        ],
        infra: [],
      }),
    },
  },
};

const resolver: PluginResolver = (id: string) => mockPlugins[id];

describe('database-query compilation (012-database-query-plugin)', () => {
  const workflowWithDb: WorkflowDefinition = {
    id: 'wf-db-query',
    name: 'Database Query Workflow',
    nodes: [
      {
        id: 'node-trigger',
        pluginId: 'trigger-manual-example',
        pluginVersion: '1.0.0',
        parameters: {},
        position: { x: 0, y: 0 },
        appearance: { label: 'Start' },
      },
      {
        id: 'node-db',
        pluginId: 'database-query',
        pluginVersion: '1.0.0',
        parameters: {
          databaseType: 'postgres',
          connectionEnvVar: 'DATABASE_URL',
          query: 'SELECT * FROM users WHERE active = true;',
        },
        position: { x: 150, y: 0 },
        appearance: { label: 'Query Users' },
      },
    ],
    connections: [
      { sourceNodeId: 'node-trigger', sourceOutput: 'main', targetNodeId: 'node-db', targetInput: 'main' },
    ],
  };

  it('compiles workflow with database-query for local adding pg dependency to package.json', async () => {
    const result = await compileWorkflow(
      {
        workflow: workflowWithDb,
        targetPlatform: 'local',
        projectName: 'Database App Local',
      },
      resolver
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    const pkgFile = result.files.find((f) => f.path === 'package.json');
    expect(pkgFile).toBeDefined();
    const pkg = JSON.parse(pkgFile!.content);
    expect(pkg.dependencies).toHaveProperty('pg');
    expect(pkg.devDependencies).toHaveProperty('@types/pg');

    const dbFile = result.files.find((f) => f.path.includes('database-query.js'));
    expect(dbFile).toBeDefined();
    expect(await loadGeneratedModule(dbFile!.content).run({})).toEqual([{ id: 42, name: 'Alice' }]);
  });

  it('compiles workflow with database-query for aws adding pg to dependencies', async () => {
    const result = await compileWorkflow(
      {
        workflow: workflowWithDb,
        targetPlatform: 'aws',
        projectName: 'Database App AWS',
      },
      resolver
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    const pkgFile = result.files.find((f) => f.path === 'package.json');
    expect(pkgFile).toBeDefined();
    const pkg = JSON.parse(pkgFile!.content);
    expect(pkg.dependencies).toHaveProperty('pg');
  });
});
