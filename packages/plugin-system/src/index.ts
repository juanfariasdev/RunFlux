// Public entry point of @runflux/plugin-system: plugin contracts, discovery and the editor-side
// services around them. Node execution lives in @runflux/runtime.

export type {
  DiscoveredPlugin,
  JsonRowFieldSchema,
  JsonRowOption,
  ParameterSchema,
  PluginCategory,
  PluginManifest,
  PluginModule,
} from './types.js';
export type { ComposeContribution, ComposeService, EnvironmentVariableDeclaration, PluginDeployment } from './deployment.js';

export { PluginRegistry, DuplicatePluginIdError } from './plugin-registry.js';
export type { DiscoverOptions, DiscoverSummary } from './plugin-registry.js';
export { PluginLoadError, loadPlugin } from './discovery/plugin-loader.js';

export { validateManifest } from './manifest-validator.js';
export type { ManifestValidationResult } from './manifest-validator.js';
export { serializeManifest, deserializeManifest } from './manifest-serializer.js';

export { listPlugins } from './api/list-plugins.js';
export { checkPluginReference } from './api/check-plugin-reference.js';
export type { PluginReferenceStatus } from './api/check-plugin-reference.js';

export { WebhookTestHub } from './webhook-test-hub.js';
export type { WebhookTestRequest } from './webhook-test-hub.js';

export { FIELDS_ROW_SCHEMA } from './fields-row-schema.js';
export { isParameterVisible, isRowFieldHidden, isRowFieldHiddenBy } from './visibility.js';
export { CONDITION_ROW_SCHEMA, COMBINATOR_OPTIONS, OPERATOR_OPTIONS, RULE_ROW_SCHEMA } from './condition-row-schema.js';
