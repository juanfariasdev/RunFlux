import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { deserializeManifest, serializeManifest } from '@runflux/plugin-system/manifest-serializer';
import { validateManifest } from '@runflux/plugin-system/sdk';
import { PluginRegistry } from '@runflux/plugin-system/plugin-registry';
import { PLUGIN_IDS } from '../support/workflows';

const directories = readdirSync(resolve('plugins'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

it('knows every plugin directory', () => {
  expect([...PLUGIN_IDS].sort()).toEqual(directories);
});

it('discovers the complete TypeScript catalog in plain Node, as the production editor build does', () => {
  const script = `import { PluginRegistry } from '@runflux/plugin-system/node';
    const registry = new PluginRegistry();
    const result = await registry.discover({ pluginDirectories: ['plugins'] });
    console.log(JSON.stringify({ ids: registry.listManifests().map((plugin) => plugin.id).sort(), errors: result.errors }));`;
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: resolve('.'), encoding: 'utf8' }));
  expect(result).toEqual({ ids: directories, errors: [] });
});

it('discovers every plugin with a valid manifest and a runtime definition', async () => {
  const registry = new PluginRegistry();
  const result = await registry.discover({ pluginDirectories: [resolve('plugins')] });
  expect(result.errors).toEqual([]);
  for (const plugin of registry.list()) {
    expect(validateManifest(plugin.manifest).success).toBe(true);
    expect(typeof plugin.definition.parseParameters).toBe('function');
    expect(typeof plugin.definition.createHandler).toBe('function');
    expect(plugin.manifest.supportedPlatforms.length).toBeGreaterThan(0);
  }
});

// The database connection stays literal: the plugin reads the variable's name from `{{$env.NAME}}`,
// which the compiler also needs to declare that variable in the exported project.
it('declares literal parameters only where source code, SQL or a variable reference is expected', async () => {
  const registry = new PluginRegistry();
  await registry.discover({ pluginDirectories: [resolve('plugins')] });
  const literal = registry.listManifests().flatMap((manifest) => manifest.parameters.filter((parameter) => parameter.expressions === false).map((parameter) => `${manifest.id}.${parameter.name}`));
  expect(literal.sort()).toEqual(['code-javascript.code', 'database-query.connectionEnvVar', 'database-query.query']);
});

it('declares per-element expressions only where a node evaluates each element of its input itself', async () => {
  const registry = new PluginRegistry();
  await registry.discover({ pluginDirectories: [resolve('plugins')] });
  const perElement = registry.listManifests().flatMap((manifest) => manifest.parameters.filter((parameter) => parameter.expressions === 'perElement').map((parameter) => `${manifest.id}.${parameter.name}`));
  expect(perElement.sort()).toEqual(['map-fields.fields', 'map-fields.value']);
});

it('preserves parameter types, expression policies and nested row schemas when exporting the plugin catalog', async () => {
  const { manifest } = await import('../../plugins/set/index');
  expect(deserializeManifest(serializeManifest(manifest))).toEqual({ success: true, manifest });
});
