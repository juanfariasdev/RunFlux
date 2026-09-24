/** Environment variables visible to nodes and to expressions as `$env`. */
export type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Whether `name` works as an environment variable in shells, `.env` files, Docker and Lambda. */
export function isEnvironmentVariableName(name: string): boolean {
  return VARIABLE_NAME.test(name);
}

/** The host process environment, or an empty one where no process exists (a browser). */
export function systemEnvironment(): EnvironmentVariables {
  const host = globalThis as { process?: { env?: EnvironmentVariables } };
  return host.process?.env ?? {};
}
