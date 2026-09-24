import {
  defineNode,
  isRecord,
  NodeOutput,
  ServiceKey,
  type NodeHandler,
  type NodeInvocation,
  type ParameterReader,
} from '@runflux/runtime';
import { PostgresClient, type DatabaseClient, type DatabaseRow } from './postgres-client.js';

export type { DatabaseClient, DatabaseRow } from './postgres-client.js';

/** Replaces the production database client, e.g. with a test double. */
export const DATABASE_CLIENT = new ServiceKey<DatabaseClient>('database-query.client');

export const DATABASE_ENGINES = ['postgres'] as const;
export const OUTPUT_MODES = ['all', 'first'] as const;

export interface DatabaseQueryParameters {
  /** Environment variable holding the connection string. */
  readonly connectionEnvVar: string;
  /** SQL with `$1`, `$2`… placeholders; kept literal so data never becomes SQL. */
  readonly query: string;
  readonly values: readonly unknown[];
  /** `all` outputs every row; `first` outputs the first row, or null. */
  readonly outputMode: (typeof OUTPUT_MODES)[number];
}

export function readConnectionEnvVar(parameters: ParameterReader): string {
  return parameters.string('connectionEnvVar', 'DATABASE_URL');
}

/**
 * Runs a parameterized SQL query. In production it queries the database; in the editor's sandbox
 * it outputs one simulated row built from the input, so workflows can be designed offline.
 */
export class DatabaseQueryNode implements NodeHandler<DatabaseQueryParameters> {
  constructor(private readonly database: DatabaseClient) {}

  async execute({ parameters, input, context }: NodeInvocation<DatabaseQueryParameters>): Promise<NodeOutput> {
    const rows = context.mode === 'production'
      ? await this.database.query(this.connectionString(parameters, context.env), parameters.query, parameters.values)
      : simulateRows(parameters, input);
    return NodeOutput.main(parameters.outputMode === 'first' ? rows[0] ?? null : rows);
  }

  dispose(): Promise<void> {
    return this.database.close();
  }

  private connectionString(parameters: DatabaseQueryParameters, env: Readonly<Record<string, string | undefined>>): string {
    const connectionString = env[parameters.connectionEnvVar];
    if (!connectionString) throw new Error(`database-query: environment variable "${parameters.connectionEnvVar}" is required`);
    return connectionString;
  }
}

function simulateRows(parameters: DatabaseQueryParameters, input: unknown): DatabaseRow[] {
  const fields = isRecord(input) ? input : { input };
  return [{ id: fields.id ?? 1, query_executed: parameters.query, success: true, ...fields }];
}

/**
 * One client per process by default: the editor creates an engine for every test run, and each
 * would otherwise open its own pools. Closing it only ends the current pools.
 */
let processClient: PostgresClient | undefined;

export default defineNode<DatabaseQueryParameters>({
  parseParameters: (parameters) => {
    parameters.choice('databaseType', DATABASE_ENGINES, 'postgres');
    return {
      connectionEnvVar: readConnectionEnvVar(parameters),
      query: parameters.string('query', 'SELECT 1;').trim(),
      values: parameters.list('queryParams'),
      outputMode: parameters.choice('outputMode', OUTPUT_MODES, 'all'),
    };
  },
  createHandler: ({ extensions, logger }) => new DatabaseQueryNode(extensions.get(DATABASE_CLIENT) ?? (processClient ??= new PostgresClient(logger))),
});
