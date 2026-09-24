import { defineNode, isRecord, NodeOutput, ServiceKey, type NodeHandler, type NodeInvocation } from '@runflux/runtime';
import { readDatabaseQueryParameters, type DatabaseQueryParameters } from './parameters.js';
import { PostgresClient, type DatabaseClient, type DatabaseRow } from './postgres-client.js';

export type { DatabaseClient, DatabaseRow } from './postgres-client.js';

/** Replaces the production database client, e.g. with a test double. Its owner closes it. */
export const DATABASE_CLIENT = new ServiceKey<DatabaseClient>('database-query.client');

/**
 * Runs a parameterized SQL query. Production executes the configured SQL. Sandbox performs a
 * harmless `SELECT 1` connection probe first, then simulates the query result so write statements
 * are never executed by an editor test while broken credentials/connections still fail visibly.
 */
export class DatabaseQueryNode implements NodeHandler<DatabaseQueryParameters> {
  private readonly database: DatabaseClient;
  private readonly release: () => Promise<void>;

  /** `release` frees what this node owns, such as the pools of a client it created. */
  constructor(database: DatabaseClient, release: () => Promise<void> = async () => {}) {
    this.database = database;
    this.release = release;
  }

  async execute({ parameters, input, context }: NodeInvocation<DatabaseQueryParameters>): Promise<NodeOutput> {
    const connectionString = this.connectionString(parameters, context.env);
    const rows = context.mode === 'production'
      ? await this.database.query(connectionString, parameters.query, parameters.values)
      : await this.simulateAfterConnectionCheck(connectionString, parameters, input);
    return NodeOutput.main(parameters.outputMode === 'first' ? rows[0] ?? null : rows);
  }

  dispose(): Promise<void> {
    return this.release();
  }

  private connectionString(parameters: DatabaseQueryParameters, env: Readonly<Record<string, string | undefined>>): string {
    const connectionString = env[parameters.connectionEnvVar];
    if (!connectionString) throw new Error(`database-query: environment variable "${parameters.connectionEnvVar}" is required`);
    return connectionString;
  }

  private async simulateAfterConnectionCheck(connectionString: string, parameters: DatabaseQueryParameters, input: unknown): Promise<DatabaseRow[]> {
    await this.database.query(connectionString, 'SELECT 1', []);
    return simulateRows(parameters, input);
  }
}

function simulateRows(parameters: DatabaseQueryParameters, input: unknown): DatabaseRow[] {
  const fields = isRecord(input) ? input : { input };
  return [{ id: fields.id ?? 1, query_executed: parameters.query, success: true, ...fields }];
}

export default defineNode<DatabaseQueryParameters>({
  parseParameters: readDatabaseQueryParameters,
  createHandler: ({ extensions, logger }) => {
    const injected = extensions.get(DATABASE_CLIENT);
    if (injected) return new DatabaseQueryNode(injected);
    // Each engine gets its own client, whose pools end when the engine is disposed.
    const client = new PostgresClient(logger);
    return new DatabaseQueryNode(client, () => client.close());
  },
});
