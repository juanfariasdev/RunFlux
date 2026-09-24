import { RuntimeBundleError, RuntimeBundler } from './bundling/runtime-bundler.js';
import { PackageRequirements } from './deployment/contributions.js';
import { DeploymentPlanner, type DeploymentPlan } from './deployment/deployment-plan.js';
import { createZipPackage } from './packager.js';
import { AwsTarget } from './targets/aws-target.js';
import type { DeploymentTarget } from './targets/deployment-target.js';
import { LocalTarget } from './targets/local-target.js';
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
  readonly targets?: Partial<Record<TargetPlatform, DeploymentTarget>>;
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
  private readonly targets: Partial<Record<TargetPlatform, DeploymentTarget>>;
  private readonly clock: () => Date;

  constructor(plugins: PluginResolver, dependencies: CompilerDependencies = {}) {
    this.validator = new WorkflowValidator(plugins);
    this.planner = new DeploymentPlanner(plugins);
    this.bundler = dependencies.bundler ?? new RuntimeBundler();
    this.targets = dependencies.targets ?? { local: new LocalTarget(), aws: new AwsTarget() };
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
    const target = this.targets[targetPlatform];
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
    return { status: 'success', projectName, targetPlatform, files, manifest, zipBuffer: await createZipPackage(files) };
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
      generatedFiles: files.map((file) => file.path),
    };
  }
}

export function compileWorkflow(request: CompilationRequest, plugins: PluginResolver): Promise<CompilationResult> {
  return new WorkflowCompiler(plugins).compile(request);
}
