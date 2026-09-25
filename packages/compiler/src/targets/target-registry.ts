import { AwsTarget } from './aws-target.js';
import type { DeploymentTarget } from './deployment-target.js';
import { LocalTarget } from './local-target.js';

/**
 * The deployment targets a compiler can build for, by platform id. A new platform is a target
 * registered here, with no change to the compiler.
 */
export class TargetRegistry {
  private readonly targets = new Map<string, DeploymentTarget>();

  constructor(targets: Iterable<DeploymentTarget> = []) {
    for (const target of targets) this.register(target);
  }

  register(target: DeploymentTarget): this {
    if (this.targets.has(target.platform)) throw new Error(`Deployment target "${target.platform}" is registered twice`);
    this.targets.set(target.platform, target);
    return this;
  }

  get(platform: string): DeploymentTarget | undefined {
    return this.targets.get(platform);
  }

  /** The registered platform ids, in registration order. */
  platforms(): string[] {
    return [...this.targets.keys()];
  }
}

/** The targets RunFlux ships: a local Node.js backend and an AWS Lambda backend. */
export function defaultTargets(): TargetRegistry {
  return new TargetRegistry([new LocalTarget(), new AwsTarget()]);
}
