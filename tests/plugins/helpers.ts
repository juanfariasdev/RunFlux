import { createRequire } from 'node:module';
import { posix } from 'node:path';
import { transformSync } from 'esbuild';
import type { PluginModule } from '@runflux/plugin-system/types';

const require = createRequire(import.meta.url);

/** Execute the actual artifact, including its exports, instead of inspecting source text. */
export function loadGenerated(source: string, dependencies: Record<string, unknown> = {}, resolve = require): Record<string, any> {
  const { code } = transformSync(source, { loader: 'ts', format: 'cjs', target: 'node20' });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports,
    (name: string) => name in dependencies ? dependencies[name] : resolve(name));
  return module.exports;
}

export function loadProject(files: Array<{ path: string; content: string }>, entry = 'src/runner.ts') {
  const cache = new Map<string, Record<string, any>>();
  function load(path: string): Record<string, any> {
    if (cache.has(path)) return cache.get(path)!;
    const file = files.find((file) => file.path === path || file.path === path.replace(/\.js$/, '.ts'));
    if (!file) throw new Error(`Missing generated module: ${path}`);
    const resolve = ((name: string) => name.startsWith('.') ? load(posix.join(posix.dirname(file.path), name)) : require(name)) as typeof require;
    const exports = loadGenerated(file.content, {}, resolve);
    cache.set(path, exports);
    return exports;
  }
  return load(entry);
}

export const context = { workflowId: 'contract', nodeId: 'node', mode: 'sandbox' as const };

export async function loadPlugin(id: string): Promise<PluginModule> {
  return import(`../../plugins/${id}/index.ts`);
}

export function compiledRun(plugin: PluginModule, platform: string, params: Record<string, unknown>, dependencies?: Record<string, unknown>) {
  const artifact = plugin.generators[platform](params, context);
  return loadGenerated(artifact.files[0].content, dependencies).run;
}
