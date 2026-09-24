/**
 * Hand-written, self-contained (zero relative imports) type declaration for
 * the "./node" export (see package.json#exports and `build:node`).
 *
 * Why not point "types" at src/index.ts: when this package's source is
 * type-checked as part of a consumer whose moduleResolution is
 * node16/nodenext (e.g. apps/workflow-editor's tsconfig.node.json, which
 * type-checks vite.config.ts), TS re-applies that consumer's extension
 * rules to every file it pulls in. A self-contained .d.ts sidesteps that.
 * Keep this in sync with src/ by hand — only the narrow surface the Vite
 * plugins and plain-Node scripts actually need.
 */

export type PluginCategory = 'trigger' | 'action' | 'output' | 'control-flow' | 'subworkflow';

export interface ParameterSchema {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  required: boolean;
  default?: unknown;
  sensitive?: boolean;
  expressions?: boolean;
  options?: Array<{ value: string; label: string }>;
  allowCustomOptions?: boolean;
  showWhen?: { parameter: string; oneOf: readonly unknown[] };
  language?: 'javascript' | 'sql';
}

export interface PluginManifest {
  id: string;
  name: string;
  category: PluginCategory;
  version: string;
  parameters: ParameterSchema[];
  supportedPlatforms: string[];
  outputs?: string[];
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

export function consoleDiscoveryLogger(message: string): void;

export class PluginRegistry {
  discover(options?: DiscoverOptions): Promise<DiscoverSummary>;
  listManifests(): PluginManifest[];
  getManifest(pluginId: string): PluginManifest | undefined;
}

export function listPlugins(registry: PluginRegistry): Record<string, PluginManifest[]>;

export interface WebhookTestRequest {
  body?: unknown;
  headers?: unknown;
  query?: unknown;
  method?: string;
}

export class WebhookTestHub {
  constructor(timeoutMs?: number);
  static shared(): WebhookTestHub;
  readonly pending: number;
  /** `channel` is a route such as `POST /orders`, or a bare path accepting any method. */
  waitFor(channel: string, signal: AbortSignal): Promise<WebhookTestRequest>;
  deliver(path: string, request: WebhookTestRequest): boolean;
  cancelAll(): void;
}
