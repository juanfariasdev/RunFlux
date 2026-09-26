import { compileWorkflow, type CompilationResult, type CompiledPlugin, type TargetPlatform } from '@runflux/compiler';
import { PluginRegistry } from '@runflux/plugin-system/plugin-registry';
import type { WorkflowConnection, WorkflowDefinition, WorkflowNode } from '@runflux/workflow-model';

export const PLUGIN_IDS = [
  'code-javascript', 'condition-if', 'condition-switch', 'database-query', 'filter', 'http-output',
  'log-output', 'map-fields', 'set', 'trigger-cron', 'trigger-manual-example', 'trigger-webhook',
] as const;

export type PluginId = (typeof PLUGIN_IDS)[number];

export function node(id: string, pluginId: PluginId | string, parameters: Record<string, unknown> = {}, label?: string): WorkflowNode {
  return { id, pluginId, pluginVersion: '1.0.0', parameters, position: { x: 0, y: 0 }, ...(label ? { appearance: { label } } : {}) };
}

export function edge(sourceNodeId: string, targetNodeId: string, sourceOutput = 'main'): WorkflowConnection {
  return { sourceNodeId, targetNodeId, sourceOutput, targetInput: 'main' };
}

export function workflow(nodes: WorkflowNode[], connections: WorkflowConnection[] = [], extra: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return { id: 'test-workflow', name: 'Test workflow', nodes, connections, ...extra };
}

/** Loads the real plugin modules of the repository, as the project server's registry would. */
export async function loadPlugins(): Promise<Map<string, CompiledPlugin>> {
  const modules = await Promise.all(PLUGIN_IDS.map(async (id) => [id, await import(`../../plugins/${id}/index.ts`)] as const));
  return new Map(modules);
}

export async function compile(definition: WorkflowDefinition, targetPlatform: TargetPlatform = 'local', projectName = 'Contract backend'): Promise<CompilationResult> {
  const plugins = await loadPlugins();
  return compileWorkflow({ workflow: definition, targetPlatform, projectName }, (id) => plugins.get(id));
}

/**
 * The editor's registry with the real plugins. Their runtime definitions are imported through the
 * test runner (not discovered from disk), so stubs and module mocks apply to them.
 */
export async function editorRegistry(): Promise<PluginRegistry> {
  const registry = new PluginRegistry();
  for (const id of PLUGIN_IDS) {
    const [module, runtime] = await Promise.all([import(`../../plugins/${id}/index.ts`), import(`../../plugins/${id}/runtime.ts`)]);
    registry.register({ ...module, definition: runtime.default, sourcePath: `plugins/${id}` });
  }
  return registry;
}
