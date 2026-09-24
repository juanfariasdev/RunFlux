import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PluginRegistry, listPlugins } from '@runflux/plugin-system/node';

const registry = new PluginRegistry();
const discovery = await registry.discover({ pluginDirectories: ['plugins'] });
assert.deepEqual(discovery.errors, [], 'Plugin discovery must not silently omit invalid modules');
assert.ok(registry.listManifests().length > 0, 'Plugin catalog must not be empty');
const catalog = JSON.parse(await readFile('apps/workflow-editor/dist/runflux-plugins.json', 'utf8'));
assert.deepEqual(catalog, listPlugins(registry), 'Built editor catalog must include every plugin and its metadata');
console.log(`Plugin catalog verified: ${registry.listManifests().length} plugins.`);
