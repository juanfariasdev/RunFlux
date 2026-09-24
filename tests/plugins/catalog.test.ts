import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { PluginRegistry } from '@runflux/plugin-system/plugin-registry';
import { validateManifest } from '@runflux/plugin-system/manifest-validator';
import { serializeManifest, deserializeManifest } from '@runflux/plugin-system/manifest-serializer';
import { loadPlugin, loadGenerated } from './helpers';

const plugins = readdirSync(resolve('plugins'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

it('discovers the complete TypeScript catalog in plain Node, as used by the production editor build', () => {
  const script = `import { PluginRegistry } from '@runflux/plugin-system/node';
    const registry = new PluginRegistry();
    const result = await registry.discover({ pluginDirectories: ['plugins'] });
    console.log(JSON.stringify({ ids: registry.listManifests().map(p => p.id).sort(), errors: result.errors }));`;
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: resolve('.'), encoding: 'utf8' }));
  expect(result).toEqual({ ids: [...plugins].sort(), errors: [] });
});

it('discovers every installed plugin without silently dropping invalid modules', async () => {
  const registry = new PluginRegistry();
  const result = await registry.discover({ pluginDirectories: [resolve('plugins')] });
  expect(result.errors).toEqual([]);
  expect(registry.listManifests().map((manifest) => manifest.id).sort()).toEqual(plugins.sort());
});

it.each(plugins)('%s exports a valid catalog entry and loadable artifacts for every declared target', async (id) => {
  const plugin = await loadPlugin(id);
  expect(validateManifest(plugin.manifest).success).toBe(true);
  expect(typeof plugin.execute).toBe('function');
  expect(Object.keys(plugin.generators).sort()).toEqual([...plugin.manifest.supportedPlatforms].sort());
  for (const platform of plugin.manifest.supportedPlatforms) {
    const artifact = plugin.generators[platform]({}, { workflowId: 'catalog', nodeId: id });
    expect(typeof loadGenerated(artifact.files[0].content).run).toBe('function');
  }
});

it('preserves parameter types, expression policies and nested row schemas when exporting the plugin catalog', async () => {
  const plugin = await loadPlugin('set');
  const result = deserializeManifest(serializeManifest(plugin.manifest));
  expect(result).toEqual({ success: true, manifest: plugin.manifest });
});
