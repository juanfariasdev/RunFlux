import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectParameterReader, type NodeDefinition } from '@runflux/runtime';
import { describe, expect, it } from 'vitest';
import { scanDirectory } from '../directory-scanner';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedFixturesDir = path.join(__dirname, '..', '..', '__tests__', 'fixtures', 'discovery-mixed');
const edgeCasesDir = path.join(__dirname, 'fixtures', 'edge-cases');

async function execute(definition: NodeDefinition, input: unknown) {
  const handler = definition.createHandler({} as never);
  return handler.execute({ parameters: definition.parseParameters(new ObjectParameterReader({}, 'test')), input, context: {} as never });
}

describe('scanDirectory', () => {
  it('loads the valid plugin with its runtime and reports the malformed one without stopping (RN-01, EC-01)', async () => {
    const result = await scanDirectory(sharedFixturesDir);
    expect(result.plugins.map((plugin) => plugin.manifest.id)).toEqual(['fixture-good-plugin']);
    expect(result.plugins[0].sourcePath).toMatch(/good-plugin$/);
    expect(await execute(result.plugins[0].definition, 'payload')).toMatchObject({ value: { received: 'payload' } });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toMatch(/bad-plugin/);
  });

  it('returns an empty result when the directory does not exist', async () => {
    expect(await scanDirectory(path.join(__dirname, 'this-does-not-exist'))).toEqual({ plugins: [], errors: [] });
  });

  it('reports each kind of malformed plugin', async () => {
    const result = await scanDirectory(edgeCasesDir);
    const errorOf = (name: string) => result.errors.find((error) => error.path.endsWith(name))?.error;
    expect(result.plugins).toEqual([]);
    expect(errorOf('no-entry-file')).toMatch(/no entry file/i);
    expect(errorOf('missing-exports')).toBe('module must export "manifest" and "runtimeModule"');
    expect(errorOf('invalid-runtime')).toMatch(/runtime module must export a node definition/);
    expect(result.errors).toHaveLength(3);
  });

  it('loads the new version of a plugin whose runtime changed', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runflux-plugin-scan-'));
    const pluginDir = path.join(rootDir, 'reloadable-plugin');
    const runtime = (value: string) => `export default {
  parseParameters: () => ({}),
  createHandler: () => ({ execute: () => ({ value: ${JSON.stringify(value)}, activeOutput: 'main' }) }),
};`;
    try {
      await fs.mkdir(pluginDir);
      await fs.writeFile(path.join(pluginDir, 'index.js'), `export const manifest = { id: 'reloadable-plugin', name: 'Reloadable', category: 'action', version: '1.0.0', parameters: [], supportedPlatforms: ['local'] };
export const runtimeModule = new URL('./runtime.js', import.meta.url);`);
      await fs.writeFile(path.join(pluginDir, 'runtime.js'), runtime('before'));
      const first = await scanDirectory(rootDir);
      await fs.writeFile(path.join(pluginDir, 'runtime.js'), runtime('after-change'));
      const second = await scanDirectory(rootDir);
      expect(await execute(first.plugins[0].definition, null)).toMatchObject({ value: 'before' });
      expect(await execute(second.plugins[0].definition, null)).toMatchObject({ value: 'after-change' });
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('loads the new version of a helper module a TypeScript runtime imports', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runflux-plugin-scan-'));
    const pluginDir = path.join(rootDir, 'helper-plugin');
    try {
      await fs.mkdir(pluginDir);
      await fs.writeFile(path.join(pluginDir, 'package.json'), '{ "type": "module" }');
      await fs.writeFile(path.join(pluginDir, 'index.ts'), `export const manifest = { id: 'helper-plugin', name: 'Helper', category: 'action', version: '1.0.0', parameters: [], supportedPlatforms: ['local'] };
export const runtimeModule = new URL('./runtime.ts', import.meta.url);`);
      await fs.writeFile(path.join(pluginDir, 'runtime.ts'), `import { greeting } from './greeting.js';
export default {
  parseParameters: () => ({}),
  createHandler: () => ({ execute: () => ({ value: greeting, activeOutput: 'main' }) }),
};`);
      await fs.writeFile(path.join(pluginDir, 'greeting.ts'), `export const greeting: string = 'hello';`);
      const first = await scanDirectory(rootDir);
      await fs.writeFile(path.join(pluginDir, 'greeting.ts'), `export const greeting: string = 'hello again';`);
      const second = await scanDirectory(rootDir);
      expect(await execute(first.plugins[0].definition, null)).toMatchObject({ value: 'hello' });
      expect(await execute(second.plugins[0].definition, null)).toMatchObject({ value: 'hello again' });
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
