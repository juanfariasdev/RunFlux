// Public entry point of @runflux/plugin-system. Prefer the subpath exports
// (e.g. `@runflux/plugin-system/plugin-registry`) for granular imports —
// this barrel is a convenience for consumers that just want the essentials.

export type {
  DiscoveredPlugin,
  ExecutorFn,
  GeneratedArtifact,
  GeneratorFn,
  InfraFragment,
  JsonRowFieldSchema,
  JsonRowOption,
  ParameterSchema,
  PluginCategory,
  PluginExecutionContext,
  PluginManifest,
  PluginModule,
  WorkflowContext,
} from './types';

export { PluginRegistry, DuplicatePluginIdError } from './plugin-registry';
export type { DiscoverOptions, DiscoverSummary } from './plugin-registry';

export { validateManifest } from './manifest-validator';
export type { ManifestValidationResult } from './manifest-validator';

export { serializeManifest, deserializeManifest } from './manifest-serializer';

export { listPlugins } from './api/list-plugins';
export { resolveGenerator, checkPluginReference } from './api/resolve-generator';
export type { PluginReferenceStatus } from './api/resolve-generator';
export { resolveExecutor } from './api/resolve-executor';

export {
  evaluateOperator,
  combineConditions,
  matchRule,
  evaluateSwitch,
  compare,
  combine,
  deepEqual,
  isEmptyValue,
} from './operators';
export type { ConditionOperator, Combinator, ConditionRule, SwitchRule, CompareOptions } from './operators';

export { getSafeEnv, getSafeNode, createSafeNodeProxy, extractContext } from './context-helpers';
export type { ExtractedContext } from './context-helpers';

export { evaluateExpression, resolveValue, resolveTemplateObject } from './evaluator';
export type { EvaluatorContext } from './evaluator';

export { normalizeFieldValue, composeFields } from './fields-row-schema';
export type { FieldConfig } from './fields-row-schema';

export {
  STANDALONE_OPERATOR_CODE,
  STANDALONE_EXPRESSION_EVALUATOR_CODE,
} from './snippets';

export {
  generateConditionIfCode,
  generateConditionSwitchCode,
  generateFilterCode,
  generateSetCode,
  generateHttpOutputCode,
  generateCodeJavascriptCode,
} from './code-generators';

