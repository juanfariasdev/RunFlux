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
export { isEnvironmentVariableName, systemEnvironment, type EnvironmentVariables } from './environment.js';
export { isRecord } from './values.js';

export { ServiceKey, ServiceRegistry, type ServiceLookup } from './services/service-registry.js';
export { ConsoleLogger, SystemClock, createRuntimeServices } from './services/default-services.js';

export { ObjectParameterReader, ParameterError, type ParameterReader } from './parameters/parameter-reader.js';

export { ExpressionError, ExpressionEvaluator, type ExpressionScope } from './expressions/expression-evaluator.js';
export { containsExpression, parseTemplate, type TemplatePart } from './expressions/expression-template.js';
export { ParameterResolver } from './expressions/parameter-resolver.js';
export { createNodeScope } from './expressions/node-scope.js';

export { ConditionEvaluator, type Combinator, type Condition, type ConditionEvaluatorOptions, type ConditionGroup } from './conditions/condition-evaluator.js';
export { CONDITION_OPERATORS, isConditionOperator, UNARY_CONDITION_OPERATORS, type ConditionOperator } from './conditions/condition-operators.js';
export { readCombinator, readConditionGroups, readConditions } from './conditions/condition-parameters.js';
export { deepEqual, isEmptyValue, isNumeric } from './conditions/value-comparison.js';
export { CronExpression, CronExpressionError, isTimeZone, type CronField, type CronFieldName, type CronItem } from './schedules/cron-expression.js';

export { FIELD_TYPES, FieldComposer, FieldTypeError, readFields, type FieldDefinition, type FieldType } from './fields/field-composer.js';

export { FetchHttpClient, HttpRequestError, type HttpClient, type HttpRequest, type HttpResponse, type HttpTransport } from './http/http-client.js';

export {
  WORKFLOW_SCHEMA_VERSION,
  WorkflowDocumentError,
  parseExecutableWorkflow,
  type ExecutableConnection,
  type ExecutableNode,
  type ExecutableWorkflow,
} from './workflow/executable-workflow.js';
export { ExecutableWorkflowBuilder, type NodeTypeDescription, type NodeTypeLookup, type WorkflowSource } from './workflow/workflow-builder.js';
export { CyclicWorkflowError, NotATriggerError, UnknownNodeError, WorkflowGraph } from './workflow/workflow-graph.js';
export {
  HOST_ROUTES,
  HTTP_METHODS,
  isHttpHeaderName,
  NO_TRIGGERS,
  normalizeRoutePath,
  parseWebhookChannel,
  webhookChannel,
  type HttpAuthentication,
  type HttpMethod,
  type HttpTrigger,
  type ScheduleTrigger,
  type TriggerBinding,
  type WebhookRequest,
  type WebhookRoute,
  type WorkflowTriggers,
} from './workflow/triggers.js';

export { StaticNodeCatalog, type NodeCatalog } from './engine/node-catalog.js';
export { InvalidNodeOutputError, UnknownNodeTypeError } from './engine/node-executor.js';
export type { NodeRecord } from './engine/node-record.js';
export { EngineDisposedError, WorkflowEngine, type NodeRunRequest, type RunRequest, type WorkflowEngineOptions } from './engine/workflow-engine.js';
export { WorkflowExecution, type ExecutionResponse, type ExecutionStatus } from './engine/workflow-execution.js';
