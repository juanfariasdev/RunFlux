import type { ProjectEnvVar } from './project-api-adapter';

/** The project's variables as `$env`: each name with its value, empty text when it has none. */
export function projectEnvironment(envVars: readonly ProjectEnvVar[] = []): Record<string, string> {
  return Object.fromEntries(envVars.filter((variable) => variable.key).map((variable) => [variable.key, variable.value ?? '']));
}
