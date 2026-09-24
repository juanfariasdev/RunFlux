import type { RuntimeEntry } from '../bundling/runtime-bundler.js';
import type { DeploymentPlan } from '../deployment/deployment-plan.js';
import type { BuildProfile } from '../project/build-profile.js';
import type { CompilationOptions, GeneratedFile, TargetPlatform } from '../types.js';

export interface TargetContext {
  readonly plan: DeploymentPlan;
  readonly projectName: string;
  readonly options: CompilationOptions;
  /** Versions of the target's `hostPackages`, as the runtime package declares them. */
  readonly hostDependencies: Readonly<Record<string, string>>;
}

/** Turns a deployment plan into the files of a backend project for one platform. */
export interface DeploymentTarget {
  readonly platform: TargetPlatform;
  /** Path of the project's main entry point, as recorded in runflux-build.json. */
  readonly entrypoint: string;
  /** The runtime subpaths this concrete workflow imports. */
  runtimeEntries(plan: DeploymentPlan, options: CompilationOptions): readonly RuntimeEntry[];
  /** npm packages imported by the runtime hosts this concrete workflow uses. */
  hostPackages(plan: DeploymentPlan, options: CompilationOptions): readonly string[];
  buildProfile(plan: DeploymentPlan, options: CompilationOptions): BuildProfile;
  files(context: TargetContext): Promise<GeneratedFile[]>;
}
