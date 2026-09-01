/**
 * Hand-written, self-contained (zero relative imports) type declaration for
 * the "./node" export (see package.json#exports and `build:node`).
 *
 * Why not point "types" at src/index.ts: when this package's source is
 * type-checked as part of a consumer whose moduleResolution is
 * node16/nodenext (e.g. apps/workflow-editor's tsconfig.node.json, which
 * type-checks vite.config.ts), TS re-applies that consumer's extension
 * rules to every file it pulls in — including this package's own internal
 * relative imports, which are written extensionless for its own
 * moduleResolution: "bundler" setup. A self-contained .d.ts with no
 * relative imports of its own sidesteps that entirely. Keep this in sync
 * with the real PluginRegistry/listPlugins signatures in src/ by hand —
 * only the narrow surface vite-plugin-plugin-catalog.ts actually needs.
 */

export type PluginCategory = 'trigger' | 'action' | 'output' | 'control-flow' | 'subworkflow';

export interface ParameterSchema {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  required: boolean;
  default?: unknown;
  sensitive?: boolean;
}

export interface PluginManifest {
  id: string;
  name: string;
  category: PluginCategory;
  version: string;
  parameters: ParameterSchema[];
  supportedPlatforms: string[];
}

export interface DiscoverOptions {
  pluginDirectories?: string[];
  nodeModulesDirectories?: string[];
  onLog?: (message: string) => void;
}

export interface DiscoverSummary {
  discovered: number;
  rejected: number;
  errors: Array<{ path: string; error: string }>;
}

export class PluginRegistry {
  discover(options?: DiscoverOptions): Promise<DiscoverSummary>;
  listManifests(): PluginManifest[];
}

export function listPlugins(registry: PluginRegistry): Record<string, PluginManifest[]>;
