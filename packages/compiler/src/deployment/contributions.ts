import { isDeepStrictEqual } from 'node:util';
import { isEnvironmentVariableName } from '@runflux/runtime';
import type { ComposeService, EnvironmentVariableDeclaration } from '@runflux/plugin-system';
import { CompilationError } from '../types.js';

/** Compose services of the generated backend itself; plugins cannot declare them. */
const RESERVED_COMPOSE_SERVICES: readonly string[] = ['app', 'cron'];

interface Owned<TValue> {
  readonly owner: string;
  readonly value: TValue;
}

/**
 * npm packages the plugins of a workflow need. Two owners may ask for the same package only with
 * the same version range; anything else would silently install one of them.
 */
export class PackageRequirements {
  private readonly packages = new Map<string, Owned<string>>();

  add(owner: string, packages: Readonly<Record<string, string>> = {}): void {
    for (const [name, version] of Object.entries(packages)) {
      const current = this.packages.get(name);
      if (current && current.value !== version) {
        throw new CompilationError('INVALID_WORKFLOW', `${current.owner} and ${owner} need different versions of "${name}": ${current.value} and ${version}`);
      }
      this.packages.set(name, current ?? { owner, value: version });
    }
  }

  toRecord(): Record<string, string> {
    return Object.fromEntries([...this.packages].map(([name, { value }]) => [name, value]));
  }
}

/** Docker Compose services the plugins run next to the backend, each declared by one plugin. */
export class ComposeServices {
  private readonly services = new Map<string, Owned<ComposeService>>();
  private readonly volumes = new Set<string>();

  add(owner: string, services: Readonly<Record<string, ComposeService>> = {}, volumes: readonly string[] = []): void {
    for (const [name, service] of Object.entries(services)) {
      if (RESERVED_COMPOSE_SERVICES.includes(name)) {
        throw new CompilationError('INVALID_WORKFLOW', `${owner} declares the compose service "${name}", which the generated backend uses`);
      }
      const current = this.services.get(name);
      if (current && !isDeepStrictEqual(current.value, service)) {
        throw new CompilationError('INVALID_WORKFLOW', `${current.owner} and ${owner} declare different compose services named "${name}"`);
      }
      this.services.set(name, current ?? { owner, value: service });
    }
    for (const volume of volumes) this.volumes.add(volume);
  }

  toRecord(): Record<string, ComposeService> {
    return Object.fromEntries([...this.services].map(([name, { value }]) => [name, value]));
  }

  volumeNames(): string[] {
    return [...this.volumes];
  }
}

/** Environment variables of the backend by name; a later declaration replaces an earlier one. */
export class EnvironmentDeclarations {
  private readonly variables = new Map<string, EnvironmentVariableDeclaration>();

  add(source: string, variables: Iterable<EnvironmentVariableDeclaration>): void {
    for (const variable of variables) {
      if (!isEnvironmentVariableName(variable.key)) {
        throw new CompilationError('INVALID_WORKFLOW', `${source}: "${variable.key}" is not an environment variable name`);
      }
      this.variables.set(variable.key, variable);
    }
  }

  list(): EnvironmentVariableDeclaration[] {
    return [...this.variables.values()];
  }
}
