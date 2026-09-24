/**
 * Hand-written, self-contained (zero relative imports) type declaration for
 * the "./node" export (see package.json#exports and `build:node`). Same
 * rationale as @runflux/plugin-system's own node.d.ts: this file is consumed
 * by vite.config.ts, loaded by plain Node before any bundler exists, so a
 * declaration with no relative imports of its own sidesteps the nodenext
 * extension-cascade problem entirely. A package-name import (not relative)
 * is fine — resolved via node_modules/#exports regardless of module mode.
 *
 * Keep this in sync with the real runWorkflow/runNode signatures in src/
 * by hand — only the narrow surface a Node-side consumer actually needs.
 */
import type { PluginRegistry } from '@runflux/plugin-system/node';

export type PluginExecutionMode = 'sandbox' | 'production';

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
}

export function runWorkflow(
  workflow: WorkflowDefinition,
  registry: PluginRegistry,
  options: ValidationRunOptions,
): Promise<ValidationRun>;

export function runNode(
  workflow: WorkflowDefinition,
  nodeId: string,
  registry: PluginRegistry,
  options: ValidationRunOptions,
  cache?: Map<string, NodeResult>,
): Promise<NodeResult>;
