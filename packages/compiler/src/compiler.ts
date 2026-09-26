import { PLUGIN_CONTRACT_VERSION } from '@runflux/plugin-system/sdk';
import { RUNTIME_CONTRACT_VERSION } from '@runflux/runtime';
import { WORKFLOW_SCHEMA_VERSION } from '@runflux/workflow-model';
import { RuntimeBundleError, RuntimeBundler } from './bundling/runtime-bundler.js';
import { PackageRequirements } from './deployment/contributions.js';
import { DeploymentPlanner, type DeploymentPlan } from './deployment/deployment-plan.js';
import type { DeploymentTarget } from './targets/deployment-target.js';
import { defaultTargets, TargetRegistry } from './targets/target-registry.js';
import {
  CompilationError,
  type BuildManifest,
  type CompilationOptions,
  type CompilationRequest,
  type CompilationResult,
  type GeneratedFile,
  type PluginResolver,
  type TargetPlatform,
} from './types.js';
import { WorkflowValidator } from './validation/workflow-validator.js';

export const RUNFLUX_VERSION = '0.1.0';

export interface CompilerDependencies {
  readonly bundler?: RuntimeBundler;
  /** The targets to build for: a registry, or targets by platform id. Defaults to defaultTargets(). */
  readonly targets?: TargetRegistry | Readonly<Record<TargetPlatform, DeploymentTarget>>;
  readonly clock?: () => Date;
}

/**
 * Compiles a workflow into a standalone backend project: validates it for the target, plans the
 * deployment from the plugins' declarations, lets the target generate the project files and
 * bundles the runtime with the plugins the workflow uses.
 */
export class WorkflowCompiler {
  private readonly validator: WorkflowValidator;
  private readonly planner: DeploymentPlanner;
  private readonly bundler: RuntimeBundler;
  private readonly target: (platform: TargetPlatform) => DeploymentTarget | undefined;
  private readonly clock: () => Date;

  constructor(plugins: PluginResolver, dependencies: CompilerDependencies = {}) {
    this.validator = new WorkflowValidator(plugins);
    this.planner = new DeploymentPlanner(plugins);
    this.bundler = dependencies.bundler ?? new RuntimeBundler();
    this.target = targetLookup(dependencies.targets ?? defaultTargets());
    this.clock = dependencies.clock ?? (() => new Date());
  }

  /** Never throws for an invalid workflow: problems become a failed result with a code. */
  async compile(request: CompilationRequest): Promise<CompilationResult> {
    try {
      return await this.compileProject(request);
    } catch (error) {
      if (error instanceof CompilationError) return error.toFailure();
      throw error;
    }
  }

  private async compileProject(request: CompilationRequest): Promise<CompilationResult> {
    const { workflow, targetPlatform, projectName, options = {} } = request;
    const target = this.target(targetPlatform);
    if (!target) throw new CompilationError('UNSUPPORTED_TARGET', `Target platform '${targetPlatform}' is not supported.`);
    this.validator.validate(workflow, targetPlatform);
    const plan = this.planner.plan(workflow, options);
    const hostPackages = target.hostPackages(plan, options);
    const hostDependencies = this.hostDependencies(target.platform, hostPackages, plan);
    const projectFiles = await target.files({ plan, projectName, options, hostDependencies });
    const runtimeFiles = await this.bundleRuntime(target, plan, options, hostPackages);
    const generated = [...projectFiles, ...runtimeFiles];
    const manifest = this.buildManifest(request, target, plan, generated);
    const files: GeneratedFile[] = [{ path: 'runflux-build.json', content: `${JSON.stringify(manifest, null, 2)}\n`, type: 'config' }, ...generated];
    return { status: 'success', projectName, targetPlatform, files, manifest };
  }

  /** The versions of the packages the target's hosts import, which the plugins must not contradict. */
  private hostDependencies(platform: TargetPlatform, hostPackages: readonly string[], plan: DeploymentPlan): Record<string, string> {
    let versions: Record<string, string>;
    try {
      versions = this.bundler.dependencyVersions(hostPackages);
    } catch (error) {
      if (error instanceof RuntimeBundleError) throw new CompilationError('GENERATOR_ERROR', error.message);
      throw error;
    }
    const requirements = new PackageRequirements();
    requirements.add(`The ${platform} runtime hosts`, versions);
    requirements.add('the workflow plugins', plan.dependencies);
    return versions;
  }

  private async bundleRuntime(target: DeploymentTarget, plan: DeploymentPlan, options: CompilationOptions, hostPackages: readonly string[]): Promise<GeneratedFile[]> {
    try {
      return await this.bundler.bundle({
        entries: target.runtimeEntries(plan, options),
        plugins: plan.plugins,
        external: [...hostPackages, ...Object.keys(plan.dependencies)],
      });
    } catch (error) {
      if (error instanceof RuntimeBundleError) throw new CompilationError('GENERATOR_ERROR', error.message);
      throw error;
    }
  }

  private buildManifest(request: CompilationRequest, target: DeploymentTarget, plan: DeploymentPlan, files: readonly GeneratedFile[]): BuildManifest {
    const profile = target.buildProfile(plan, request.options ?? {});
    return {
      runfluxVersion: RUNFLUX_VERSION,
      targetPlatform: request.targetPlatform,
      workflowId: request.workflow.id,
      projectName: request.projectName,
      workflowVersion: request.projectVersion || 'v1',
      compiledAt: this.clock().toISOString(),
      entrypoint: target.entrypoint,
      build: { entryPoints: [...profile.entryPoints], bundleDependencies: profile.bundleDependencies },
      nodeCount: request.workflow.nodes.length,
      pluginVersions: { ...plan.pluginVersions },
      contracts: { runtime: RUNTIME_CONTRACT_VERSION, plugin: PLUGIN_CONTRACT_VERSION, workflowSchema: WORKFLOW_SCHEMA_VERSION },
      generatedFiles: files.map((file) => file.path),
    };
  }
}

/** Finds a target in a registry, or in a record by its own keys only. */
function targetLookup(targets: TargetRegistry | Readonly<Record<TargetPlatform, DeploymentTarget>>): (platform: TargetPlatform) => DeploymentTarget | undefined {
  if (targets instanceof TargetRegistry) return (platform) => targets.get(platform);
  return (platform) => (Object.hasOwn(targets, platform) ? targets[platform] : undefined);
}

export function compileWorkflow(request: CompilationRequest, plugins: PluginResolver): Promise<CompilationResult> {
  return new WorkflowCompiler(plugins).compile(request);
}
