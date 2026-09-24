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
  /** The runtime subpaths the project imports. */
  readonly runtimeEntries: readonly RuntimeEntry[];
  /** npm packages the runtime hosts of this target import; the bundle leaves them external. */
  readonly hostPackages: readonly string[];
  buildProfile(plan: DeploymentPlan): BuildProfile;
  files(context: TargetContext): Promise<GeneratedFile[]>;
}
