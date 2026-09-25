/**
 * Hand-written, self-contained (zero relative imports) type declaration for
 * the "./node" export (see package.json#exports and `build:node`). Same
 * rationale as @runflux/plugin-system's own node.d.ts: this file is consumed
 * by vite.config.ts, loaded by plain Node before any bundler exists, so a
 * declaration with no relative imports of its own sidesteps the nodenext
 * extension-cascade problem entirely. A package-name import (not relative)
 * is fine — resolved via node_modules/#exports regardless of module mode.
 *
 * Keep this in sync with the real runWorkflow/runWorkflowToNode/runNode signatures in src/
 * by hand — only the narrow surface a Node-side consumer actually needs.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export type PluginExecutionMode = 'sandbox' | 'production';

/** What a test run needs from the plugins: their runtime definitions and manifests. A PluginRegistry is one. */
export interface ValidationCatalog {
  resolve(pluginId: string): unknown;
  readonly describe: (pluginId: string) => unknown;
}

export interface WorkflowNode {
  id: string;
  pluginId: string;
  pluginVersion: string;
  parameters: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface WorkflowConnection {
  sourceNodeId: string;
  sourceOutput: string;
  targetNodeId: string;
  targetInput: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
}

/** Delivers external events, such as webhook test requests, to the triggers waiting for them. */
export interface TriggerEventSource {
  waitFor(channel: string, signal: AbortSignal): Promise<unknown>;
}

export interface ValidationRunOptions {
  mode: PluginExecutionMode;
  services?: { triggerEvents?: TriggerEventSource };
  /** Cancels the run, for instance when the request that started it is closed. */
  signal?: AbortSignal;
  /** `$env` of the nodes. Defaults to the process environment. */
  environment?: Readonly<Record<string, string | undefined>>;
}

export interface NodeResult {
  nodeId: string;
  input: unknown;
  output: unknown | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ValidationRun {
  workflowId: string;
  mode: PluginExecutionMode;
  nodeResults: NodeResult[];
  startedAt: string;
  finishedAt: string;
  status: 'success' | 'error' | 'partial';
  cancelled: boolean;
}

export function runWorkflow(
  workflow: WorkflowDefinition,
  catalog: ValidationCatalog,
  options: ValidationRunOptions,
): Promise<ValidationRun>;

export function runWorkflowToNode(
  workflow: WorkflowDefinition,
  nodeId: string,
  catalog: ValidationCatalog,
  options: ValidationRunOptions,
): Promise<ValidationRun>;

export function runNode(
  workflow: WorkflowDefinition,
  nodeId: string,
  catalog: ValidationCatalog,
  options: ValidationRunOptions,
  cache?: Map<string, NodeResult>,
): Promise<NodeResult>;

/** What the handlers need from the webhook test hub. */
export interface WebhookDelivery extends TriggerEventSource {
  deliver(path: string, request: { body?: unknown; headers?: unknown; query?: unknown; method?: string }): boolean;
  cancelAll(): void;
}

export interface ValidationHttpOptions {
  readonly catalog: () => Promise<ValidationCatalog>;
  readonly webhooks: WebhookDelivery;
  readonly environment?: () => Readonly<Record<string, string | undefined>>;
}

/** The test execution endpoints of the editor, over plain node:http requests. */
export interface ValidationHttpHandlers {
  validate(request: IncomingMessage, response: ServerResponse): void;
  deliverWebhook(request: IncomingMessage, response: ServerResponse): boolean;
  cancelWebhooks(request: IncomingMessage, response: ServerResponse): void;
}

export function createValidationHttpHandlers(options: ValidationHttpOptions): ValidationHttpHandlers;
