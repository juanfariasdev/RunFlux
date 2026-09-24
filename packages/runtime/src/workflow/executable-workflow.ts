import { isRecord } from '../values.js';
import { HTTP_METHODS, type HttpTrigger, type ScheduleTrigger, type WorkflowTriggers } from './triggers.js';

export const WORKFLOW_SCHEMA_VERSION = 1;

/** A node as the engine runs it: its plugin, configuration and output ports. */
export interface ExecutableNode {
  readonly id: string;
  /** Alternative name under which later nodes find this node's output in `$node`. */
  readonly label?: string;
  readonly pluginId: string;
  readonly trigger: boolean;
  readonly outputs: readonly string[];
  readonly parameters: Readonly<Record<string, unknown>>;
  /** Parameters passed verbatim, without resolving `{{ }}` (source code, SQL). */
  readonly literalParameters: readonly string[];
}

export interface ExecutableConnection {
  readonly source: string;
  readonly sourceOutput: string;
  readonly target: string;
  readonly targetInput: string;
}

/** Everything an engine needs to run a workflow; exported backends ship it as `workflow.json`. */
export interface ExecutableWorkflow {
  readonly schemaVersion: typeof WORKFLOW_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly nodes: readonly ExecutableNode[];
  readonly connections: readonly ExecutableConnection[];
  readonly triggers: WorkflowTriggers;
}

export class WorkflowDocumentError extends Error {
  constructor(problem: string) {
    super(`Invalid workflow document: ${problem}`);
    this.name = 'WorkflowDocumentError';
  }
}

/** Validates an untrusted document, such as a `workflow.json` read from disk. */
export function parseExecutableWorkflow(document: unknown): ExecutableWorkflow {
  const root = record(document, 'the document');
  if (root.schemaVersion !== WORKFLOW_SCHEMA_VERSION) {
    throw new WorkflowDocumentError(`unsupported schemaVersion ${JSON.stringify(root.schemaVersion)}`);
  }
  const triggers = record(root.triggers, 'triggers');
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    id: text(root.id, 'id'),
    name: text(root.name, 'name'),
    nodes: list(root.nodes, 'nodes').map((value, index) => parseNode(value, `nodes[${index}]`)),
    connections: list(root.connections, 'connections').map((value, index) => parseConnection(value, `connections[${index}]`)),
    triggers: {
      http: list(triggers.http, 'triggers.http').map((value, index) => parseHttpTrigger(value, `triggers.http[${index}]`)),
      schedules: list(triggers.schedules, 'triggers.schedules').map((value, index) => parseSchedule(value, `triggers.schedules[${index}]`)),
    },
  };
}

function parseNode(value: unknown, path: string): ExecutableNode {
  const node = record(value, path);
  return {
    id: text(node.id, `${path}.id`),
    ...(node.label === undefined ? {} : { label: text(node.label, `${path}.label`) }),
    pluginId: text(node.pluginId, `${path}.pluginId`),
    trigger: flag(node.trigger, `${path}.trigger`),
    outputs: list(node.outputs, `${path}.outputs`).map((output, index) => text(output, `${path}.outputs[${index}]`)),
    parameters: record(node.parameters, `${path}.parameters`),
    literalParameters: list(node.literalParameters, `${path}.literalParameters`).map((name, index) => text(name, `${path}.literalParameters[${index}]`)),
  };
}

function parseConnection(value: unknown, path: string): ExecutableConnection {
  const connection = record(value, path);
  return {
    source: text(connection.source, `${path}.source`),
    sourceOutput: text(connection.sourceOutput, `${path}.sourceOutput`),
    target: text(connection.target, `${path}.target`),
    targetInput: text(connection.targetInput, `${path}.targetInput`),
  };
}

function parseHttpTrigger(value: unknown, path: string): HttpTrigger {
  const trigger = record(value, path);
  const method = text(trigger.method, `${path}.method`);
  if (method !== 'ANY' && !(HTTP_METHODS as readonly string[]).includes(method)) {
    throw new WorkflowDocumentError(`${path}.method "${method}" is not an HTTP method`);
  }
  const authentication = record(trigger.authentication, `${path}.authentication`);
  return {
    nodeId: text(trigger.nodeId, `${path}.nodeId`),
    path: text(trigger.path, `${path}.path`),
    method: method as HttpTrigger['method'],
    authentication: authentication.type === 'none'
      ? { type: 'none' }
      : authentication.type === 'header'
        ? {
            type: 'header',
            headerName: text(authentication.headerName, `${path}.authentication.headerName`),
            secretEnvVar: text(authentication.secretEnvVar, `${path}.authentication.secretEnvVar`),
          }
        : fail(`${path}.authentication.type must be "none" or "header"`),
    rawBody: flag(trigger.rawBody, `${path}.rawBody`),
  };
}

function parseSchedule(value: unknown, path: string): ScheduleTrigger {
  const schedule = record(value, path);
  return {
    nodeId: text(schedule.nodeId, `${path}.nodeId`),
    expression: text(schedule.expression, `${path}.expression`),
    timezone: text(schedule.timezone, `${path}.timezone`),
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  return isRecord(value) ? value : fail(`${path} must be an object`);
}

function list(value: unknown, path: string): unknown[] {
  return Array.isArray(value) ? value : fail(`${path} must be a list`);
}

function text(value: unknown, path: string): string {
  return typeof value === 'string' ? value : fail(`${path} must be text`);
}

function flag(value: unknown, path: string): boolean {
  return typeof value === 'boolean' ? value : fail(`${path} must be true or false`);
}

function fail(problem: string): never {
  throw new WorkflowDocumentError(problem);
}
