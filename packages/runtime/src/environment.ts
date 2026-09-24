/** Environment variables visible to nodes and to expressions as `$env`. */
export type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

/** The host process environment, or an empty one where no process exists (a browser). */
export function systemEnvironment(): EnvironmentVariables {
  const host = globalThis as { process?: { env?: EnvironmentVariables } };
  return host.process?.env ?? {};
}
