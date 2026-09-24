// Browser-safe core of the runtime. Hosts, which need Node.js, live in the subpath exports
// (`@runflux/runtime/express`, `/lambda`, `/cron`, `/cli`).

export {
  MAIN_OUTPUT,
  NodeOutput,
  defineNode,
  type ExecutionMode,
  type NodeContext,
  type NodeDefinition,
  type NodeHandler,
  type NodeInvocation,
  type NodeOutputs,
} from './contracts/node.js';
export type { Clock, Logger, RuntimeServices, TriggerEventSource } from './contracts/services.js';
export { systemEnvironment, type EnvironmentVariables } from './environment.js';

export { ServiceKey, ServiceRegistry } from './services/service-registry.js';
export { ConsoleLogger, SystemClock, createRuntimeServices } from './services/default-services.js';

export { ParameterError, ParameterReader } from './parameters/parameter-reader.js';

export { ExpressionError, ExpressionEvaluator, type ExpressionScope } from './expressions/expression-evaluator.js';
export { ParameterResolver } from './expressions/parameter-resolver.js';
export { createNodeScope } from './expressions/node-scope.js';

export { ConditionEvaluator, type Combinator, type Condition, type ConditionEvaluatorOptions, type ConditionGroup } from './conditions/condition-evaluator.js';
export { CONDITION_OPERATORS, isConditionOperator, type ConditionOperator } from './conditions/condition-operators.js';
export { readCombinator, readConditionGroups, readConditions } from './conditions/condition-parameters.js';
export { deepEqual, isEmptyValue, isNumeric } from './conditions/value-comparison.js';

export { FIELD_TYPES, FieldComposer, FieldTypeError, readFields, type FieldDefinition, type FieldType } from './fields/field-composer.js';

export { HttpClient, HttpRequestError, type HttpRequest, type HttpResponse, type HttpTransport } from './http/http-client.js';

export {
  WORKFLOW_SCHEMA_VERSION,
  WorkflowDocumentError,
  parseExecutableWorkflow,
  type ExecutableConnection,
  type ExecutableNode,
  type ExecutableWorkflow,
} from './workflow/executable-workflow.js';
export { ExecutableWorkflowBuilder, type NodeTypeDescription, type NodeTypeLookup, type WorkflowSource } from './workflow/workflow-builder.js';
export { CyclicWorkflowError, UnknownNodeError, WorkflowGraph } from './workflow/workflow-graph.js';
export {
  HTTP_METHODS,
  NO_TRIGGERS,
  type HttpAuthentication,
  type HttpMethod,
  type HttpTrigger,
  type ScheduleTrigger,
  type TriggerBinding,
  type WebhookRequest,
  type WorkflowTriggers,
} from './workflow/triggers.js';

export { StaticNodeCatalog, type NodeCatalog } from './engine/node-catalog.js';
export { InvalidNodeOutputError, UnknownNodeTypeError } from './engine/node-executor.js';
export type { NodeRecord } from './engine/node-record.js';
export { WorkflowEngine, type RunRequest, type WorkflowEngineOptions } from './engine/workflow-engine.js';
export { WorkflowExecution, type ExecutionResponse, type ExecutionStatus } from './engine/workflow-execution.js';
