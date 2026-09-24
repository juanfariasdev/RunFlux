import type { PluginModule } from '@runflux/plugin-system/types';
import { readConnectionEnvVar } from './runtime.js';

/**
 * Database Query (012-database-query-plugin): runs parameterized SQL against PostgreSQL. The SQL
 * is literal; workflow data reaches it only through `queryParams` bound to `$1`, `$2`…
 */
export const manifest: PluginModule['manifest'] = {
  id: 'database-query',
  name: 'Database Query',
  category: 'action',
  version: '1.0.0',
  parameters: [
    { name: 'databaseType', label: 'Database Engine', type: 'string', required: true, default: 'postgres' },
    { name: 'connectionEnvVar', label: 'Connection Env Var', type: 'string', required: true, default: 'DATABASE_URL' },
    { name: 'query', label: 'SQL Query', expressions: false, type: 'string', required: true, default: 'SELECT * FROM users LIMIT 10;' },
    { name: 'queryParams', label: 'Query Parameters ($1, $2, ...)', type: 'json', required: false, default: [] },
    { name: 'outputMode', label: 'Output Mode', type: 'string', required: false, default: 'all' },
  ],
  supportedPlatforms: ['local', 'aws'],
};

export const runtimeModule = new URL('./runtime.ts', import.meta.url);

export const deployment: PluginModule['deployment'] = {
  dependencies: { pg: '^8.13.0' },
  environment: (parameters) => [{ key: readConnectionEnvVar(parameters), description: 'PostgreSQL connection string' }],
  compose: {
    services: {
      postgres: {
        image: 'postgres:16-alpine',
        environment: {
          POSTGRES_USER: '${POSTGRES_USER:-postgres}',
          POSTGRES_PASSWORD: '${POSTGRES_PASSWORD:-postgres}',
          POSTGRES_DB: '${POSTGRES_DB:-runflux}',
        },
        ports: ['${POSTGRES_PORT:-5432}:5432'],
        volumes: ['pgdata:/var/lib/postgresql/data'],
      },
    },
    volumes: ['pgdata'],
  },
};
