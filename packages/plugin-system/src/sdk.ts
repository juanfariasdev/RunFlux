// The plugin contract, safe for the browser: what plugin authors and the editor import. Discovery,
// the registry and the webhook test hub need Node.js and stay in the package's main entry.

export type {
  JsonRowFieldSchema,
  JsonRowOption,
  ParameterSchema,
  PluginCategory,
  PluginManifest,
  PluginModule,
} from './types.js';
export type { ComposeContribution, ComposeService, EnvironmentVariableDeclaration, PluginDeployment } from './deployment.js';
export { validateManifest, type ManifestValidationResult } from './manifest-validator.js';
export { checkPluginReference, type PluginReferenceStatus } from './api/check-plugin-reference.js';
export { FIELDS_ROW_SCHEMA } from './fields-row-schema.js';
export { CONDITION_ROW_SCHEMA, COMBINATOR_OPTIONS, OPERATOR_OPTIONS, RULE_ROW_SCHEMA } from './condition-row-schema.js';
export { isParameterVisible, isRowFieldHidden, isRowFieldHiddenBy } from './visibility.js';
