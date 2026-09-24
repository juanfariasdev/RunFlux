import {
  ExecutableWorkflowBuilder,
  ParameterReader,
  type ExecutableWorkflow,
  type HttpTrigger,
  type ScheduleTrigger,
} from '@runflux/runtime';
import type { ComposeService, EnvironmentVariableDeclaration } from '@runflux/plugin-system';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import { CompilationError, type CompilationOptions, type CompiledPlugin, type PluginResolver } from '../types.js';

/** A plugin whose runtime is bundled into the backend. */
export interface BundledPlugin {
  readonly id: string;
  readonly runtimeModule: URL | string;
}

/** Everything a deployment target needs to generate a backend project. */
export interface DeploymentPlan {
  /** The document the backend runs (`workflow.json`), with its HTTP and schedule triggers. */
  readonly workflow: ExecutableWorkflow;
  readonly environment: readonly EnvironmentVariableDeclaration[];
  /** npm packages the plugins' runtimes import. */
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly composeServices: Readonly<Record<string, ComposeService>>;
  readonly composeVolumes: readonly string[];
  readonly plugins: readonly BundledPlugin[];
  readonly pluginVersions: Readonly<Record<string, string>>;
}

/**
 * Collects the contributions every node's plugin declares in its `deployment`. The workflow's own
 * environment variables (or those given in the options) come last, so their values and
 * descriptions win.
 */
export class DeploymentPlanner {
  constructor(private readonly plugins: PluginResolver) {}

  plan(workflow: WorkflowDefinition, options: CompilationOptions = {}): DeploymentPlan {
    const http: HttpTrigger[] = [];
    const schedules: ScheduleTrigger[] = [];
    const environment = new Map<string, EnvironmentVariableDeclaration>();
    const dependencies: Record<string, string> = {};
    const devDependencies: Record<string, string> = {};
    const composeServices: Record<string, ComposeService> = {};
    const composeVolumes = new Set<string>();
    const used = new Map<string, CompiledPlugin>();

    for (const node of workflow.nodes) {
      const plugin = this.require(node.pluginId);
      used.set(node.pluginId, plugin);
      const { deployment } = plugin;
      if (!deployment) continue;
      const parameters = new ParameterReader(node.parameters ?? {}, node.pluginId);
      try {
        for (const binding of deployment.triggers?.(parameters) ?? []) {
          if (binding.kind === 'http') {
            const { kind: _kind, ...trigger } = binding;
            http.push({ nodeId: node.id, ...trigger });
          } else {
            const { kind: _kind, ...trigger } = binding;
            schedules.push({ nodeId: node.id, ...trigger });
          }
        }
        for (const variable of deployment.environment?.(parameters) ?? []) environment.set(variable.key, variable);
      } catch (error) {
        throw new CompilationError('INVALID_WORKFLOW', `Node "${node.id}": ${error instanceof Error ? error.message : String(error)}`);
      }
      Object.assign(dependencies, deployment.dependencies);
      Object.assign(devDependencies, deployment.devDependencies);
      Object.assign(composeServices, deployment.compose?.services);
      for (const volume of deployment.compose?.volumes ?? []) composeVolumes.add(volume);
    }
    for (const variable of options.envVars ?? workflow.settings?.envVars ?? []) environment.set(variable.key, variable);
    assertDistinctRoutes(http);

    return {
      workflow: new ExecutableWorkflowBuilder((pluginId) => this.plugins(pluginId)?.manifest).build(workflow, { http, schedules }),
      environment: [...environment.values()],
      dependencies,
      devDependencies,
      composeServices,
      composeVolumes: [...composeVolumes],
      plugins: [...used].map(([id, plugin]) => ({ id, runtimeModule: plugin.runtimeModule })),
      pluginVersions: Object.fromEntries([...used].map(([id, plugin]) => [id, plugin.manifest.version])),
    };
  }

  private require(pluginId: string): CompiledPlugin {
    const plugin = this.plugins(pluginId);
    if (!plugin) throw new CompilationError('INVALID_WORKFLOW', `Plugin "${pluginId}" is not installed`);
    return plugin;
  }
}

/** Two triggers cannot answer the same request: same path and method, or ANY with anything. */
function assertDistinctRoutes(triggers: readonly HttpTrigger[]): void {
  const methodsByPath = new Map<string, HttpTrigger[]>();
  for (const trigger of triggers) {
    const path = trigger.path.length > 1 ? trigger.path.replace(/\/+$/, '') : trigger.path;
    const clash = (methodsByPath.get(path) ?? []).find((other) => other.method === trigger.method || other.method === 'ANY' || trigger.method === 'ANY');
    if (clash) {
      throw new CompilationError('INVALID_WORKFLOW', `Webhooks "${clash.nodeId}" and "${trigger.nodeId}" both answer ${trigger.method} ${trigger.path}`);
    }
    methodsByPath.set(path, [...methodsByPath.get(path) ?? [], trigger]);
  }
}
