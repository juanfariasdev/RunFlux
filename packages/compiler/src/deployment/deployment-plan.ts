import {
  ExecutableWorkflowBuilder,
  normalizeRoutePath,
  ObjectParameterReader,
  type ExecutableNode,
  type ExecutableWorkflow,
  type HttpTrigger,
  type ScheduleTrigger,
} from '@runflux/runtime';
import type { ComposeService, EnvironmentVariableDeclaration, PluginDeployment } from '@runflux/plugin-system';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import { CompilationError, type CompilationOptions, type CompiledPlugin, type PluginResolver } from '../types.js';
import { ComposeServices, EnvironmentDeclarations, PackageRequirements } from './contributions.js';

/** Paths the local backend serves itself, which no webhook may take. */
export const RESERVED_ROUTES: readonly string[] = ['/health', '/api/execute'];

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
 * Collects the contributions every node's plugin declares in its `deployment`, reading each node's
 * parameters as the backend will run them (manifest defaults included). The workflow's own
 * environment variables (or those given in the options) come last, so their values and
 * descriptions win. Conflicting contributions are rejected.
 */
export class DeploymentPlanner {
  private readonly plugins: PluginResolver;

  constructor(plugins: PluginResolver) {
    this.plugins = plugins;
  }

  plan(workflow: WorkflowDefinition, options: CompilationOptions = {}): DeploymentPlan {
    const used = new Map(workflow.nodes.map((node) => [node.pluginId, this.require(node.pluginId)]));
    const document = new ExecutableWorkflowBuilder((pluginId) => used.get(pluginId)?.manifest).build(workflow);
    const http: HttpTrigger[] = [];
    const schedules: ScheduleTrigger[] = [];
    const environment = new EnvironmentDeclarations();
    const dependencies = new PackageRequirements();
    const devDependencies = new PackageRequirements();
    const compose = new ComposeServices();

    for (const node of document.nodes) {
      const { deployment } = used.get(node.pluginId)!;
      if (!deployment) continue;
      const contribution = nodeContribution(node, deployment);
      http.push(...contribution.http);
      schedules.push(...contribution.schedules);
      environment.add(`Node "${node.id}"`, contribution.environment);
    }
    for (const [pluginId, { deployment }] of used) {
      const owner = `Plugin "${pluginId}"`;
      dependencies.add(owner, deployment?.dependencies);
      devDependencies.add(owner, deployment?.devDependencies);
      compose.add(owner, deployment?.compose?.services, deployment?.compose?.volumes);
    }
    environment.add('The workflow settings', options.envVars ?? workflow.settings?.envVars ?? []);
    assertDistinctRoutes(http);

    return {
      workflow: { ...document, triggers: { http, schedules } },
      environment: environment.list(),
      dependencies: dependencies.toRecord(),
      devDependencies: devDependencies.toRecord(),
      composeServices: compose.toRecord(),
      composeVolumes: compose.volumeNames(),
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

interface NodeContribution {
  readonly http: HttpTrigger[];
  readonly schedules: ScheduleTrigger[];
  readonly environment: readonly EnvironmentVariableDeclaration[];
}

/** The triggers and variables one node declares; invalid parameters are reported with the node. */
function nodeContribution(node: ExecutableNode, deployment: PluginDeployment): NodeContribution {
  const parameters = new ObjectParameterReader(node.parameters, node.pluginId);
  try {
    const contribution: NodeContribution = { http: [], schedules: [], environment: deployment.environment?.(parameters) ?? [] };
    for (const { kind, ...binding } of deployment.triggers?.(parameters) ?? []) {
      if (kind === 'http') contribution.http.push({ nodeId: node.id, ...(binding as Omit<HttpTrigger, 'nodeId'>) });
      else contribution.schedules.push({ nodeId: node.id, ...(binding as Omit<ScheduleTrigger, 'nodeId'>) });
    }
    return contribution;
  } catch (error) {
    throw new CompilationError('INVALID_WORKFLOW', `Node "${node.id}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Webhooks must be reachable: two cannot answer the same request (same path and method, or ANY
 * with anything), and none can take a path the backend serves itself. Paths compare the way the
 * hosts route them.
 */
function assertDistinctRoutes(triggers: readonly HttpTrigger[]): void {
  const byPath = new Map<string, HttpTrigger[]>();
  for (const trigger of triggers) {
    const path = normalizeRoutePath(trigger.path);
    if (RESERVED_ROUTES.includes(path)) {
      throw new CompilationError('INVALID_WORKFLOW', `Webhook "${trigger.nodeId}" cannot use ${path}, which the backend serves itself`);
    }
    const clash = (byPath.get(path) ?? []).find((other) => other.method === trigger.method || other.method === 'ANY' || trigger.method === 'ANY');
    if (clash) {
      throw new CompilationError('INVALID_WORKFLOW', `Webhooks "${clash.nodeId}" and "${trigger.nodeId}" both answer ${trigger.method} ${path}`);
    }
    byPath.set(path, [...byPath.get(path) ?? [], trigger]);
  }
}
