import type { ProjectEnvVarView } from './project-api-adapter';

/** What a preview shows for a variable that has a value: never the value itself (RN-12). */
export const MASKED_VALUE = '••••••';

/** The project's variables as `$env` of previews: the mask for a variable with a value, empty text otherwise. */
export function projectEnvironment(envVars: readonly ProjectEnvVarView[] = []): Record<string, string> {
  return Object.fromEntries(envVars.filter((variable) => variable.key).map((variable) => [variable.key, variable.hasValue ? MASKED_VALUE : '']));
}
