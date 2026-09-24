import { isEnvironmentVariableName, type ParameterReader } from '@runflux/runtime';

export const DATABASE_ENGINES = ['postgres'] as const;
export const OUTPUT_MODES = ['all', 'first'] as const;

export const DATABASE_ENGINE_OPTIONS = [{ value: 'postgres', label: 'PostgreSQL' }] satisfies Array<{ value: (typeof DATABASE_ENGINES)[number]; label: string }>;
export const OUTPUT_MODE_OPTIONS = [
  { value: 'all', label: 'All rows' },
  { value: 'first', label: 'First row' },
] satisfies Array<{ value: (typeof OUTPUT_MODES)[number]; label: string }>;

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
  const name = parameters.string('connectionEnvVar', 'DATABASE_URL');
  if (!isEnvironmentVariableName(name)) throw parameters.error('connectionEnvVar', `"${name}" is not an environment variable name`);
  return name;
}

export function readDatabaseQueryParameters(parameters: ParameterReader): DatabaseQueryParameters {
  parameters.choice('databaseType', DATABASE_ENGINES, 'postgres');
  return {
    connectionEnvVar: readConnectionEnvVar(parameters),
    query: parameters.requiredString('query').trim(),
    values: parameters.list('queryParams'),
    outputMode: parameters.choice('outputMode', OUTPUT_MODES, 'all'),
  };
}
