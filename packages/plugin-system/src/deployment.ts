import type { ParameterReader, TriggerBinding } from '@runflux/runtime';

/** An environment variable an exported backend needs, as listed in `.env.example` and the AWS stack. */
export interface EnvironmentVariableDeclaration {
  readonly key: string;
  readonly value?: string;
  readonly description?: string;
}

/** A container Docker Compose starts next to a local backend, such as its database. */
export interface ComposeService {
  readonly image: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly ports?: readonly string[];
  readonly volumes?: readonly string[];
}

export interface ComposeContribution {
  readonly services: Readonly<Record<string, ComposeService>>;
  /** Named volumes the services mount. */
  readonly volumes?: readonly string[];
}

/**
 * What a plugin contributes to an exported backend besides running its nodes. The compiler reads
 * these declarations instead of knowing plugins by id. Methods receive the raw parameters of one
 * node of the plugin.
 */
export interface PluginDeployment {
  /** npm packages the plugin's runtime imports, e.g. a database driver. */
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  environment?(parameters: ParameterReader): readonly EnvironmentVariableDeclaration[];
  /** External entry points of a trigger node: HTTP endpoints or schedules. */
  triggers?(parameters: ParameterReader): readonly TriggerBinding[];
  readonly compose?: ComposeContribution;
}
