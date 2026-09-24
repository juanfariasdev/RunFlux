import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectParameterReader } from '@runflux/runtime';
import { describe, expect, it } from 'vitest';
import { DuplicatePluginIdError, PluginRegistry } from '../plugin-registry';
import { passThroughDefinition, testPlugin } from '../testing';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'discovery-mixed');

describe('PluginRegistry.register', () => {
  it('registers a plugin and exposes its manifest and definition', () => {
    const registry = new PluginRegistry();
    registry.register(testPlugin({ id: 'action-example', outputs: ['main'] }));
    expect(registry.listManifests().map((manifest) => manifest.id)).toEqual(['action-example']);
    expect(registry.getManifest('action-example')?.version).toBe('1.0.0');
    expect(registry.get('action-example')?.sourcePath).toBe('/plugins/action-example');
    expect(registry.resolve('action-example')).toBe(passThroughDefinition);
    expect(registry.describe('action-example')?.outputs).toEqual(['main']);
  });

  it('knows nothing about unregistered plugins', () => {
    const registry = new PluginRegistry();
    expect(registry.listManifests()).toEqual([]);
    expect(registry.getManifest('absent')).toBeUndefined();
    expect(registry.resolve('absent')).toBeUndefined();
    expect(registry.describe('absent')).toBeUndefined();
  });

  it('rejects a second plugin with the same id and keeps the first (EC-02)', () => {
    const registry = new PluginRegistry();
    registry.register(testPlugin({ id: 'same' }));
    expect(() => registry.register({ ...testPlugin({ id: 'same' }), sourcePath: '/plugins/other' })).toThrow(DuplicatePluginIdError);
    expect(registry.list()).toHaveLength(1);
  });
});

describe('PluginRegistry.registerModule', () => {
  it('imports the runtime of an already loaded module', async () => {
    const registry = new PluginRegistry();
    const plugin = await registry.registerModule(await import('./fixtures/discovery-mixed/good-plugin/index'), '/fixtures/good');
    const handler = plugin.definition.createHandler({} as never) as { execute: (invocation: object) => unknown };
    expect(plugin.definition.parseParameters(new ObjectParameterReader({}, 'good'))).toEqual({});
    expect(handler.execute({ input: 1 })).toMatchObject({ value: { received: 1 }, activeOutput: 'main' });
    expect(registry.getManifest('fixture-good-plugin')).toBeDefined();
  });

  it('rejects a module without a runtime', async () => {
    const registry = new PluginRegistry();
    await expect(registry.registerModule({ manifest: testPlugin({ id: 'x' }).manifest } as never, '/x')).rejects.toThrow('module must export "manifest" and "runtimeModule"');
  });
});

describe('PluginRegistry.discover', () => {
  it('registers valid plugins and reports malformed ones without throwing', async () => {
    const registry = new PluginRegistry();
    const logs: string[] = [];
    const summary = await registry.discover({ pluginDirectories: [fixturesDir], onLog: (message) => logs.push(message) });
    expect(summary.discovered).toBe(1);
    expect(summary.errors).toEqual([expect.objectContaining({ path: expect.stringContaining('bad-plugin'), error: expect.stringContaining('id') })]);
    expect(registry.getManifest('fixture-good-plugin')).toBeDefined();
    expect(logs[0]).toBe('Plugin discovery: 1 plugin(s) registered, 1 rejected/malformed.');
  });

  it('discovers nothing without directories', async () => {
    expect(await new PluginRegistry().discover()).toEqual({ discovered: 0, rejected: 0, errors: [] });
  });

  it('counts a duplicate found by discovery as rejected', async () => {
    const registry = new PluginRegistry();
    await registry.discover({ pluginDirectories: [fixturesDir] });
    const second = await registry.discover({ pluginDirectories: [fixturesDir] });
    expect(second).toMatchObject({ discovered: 0, rejected: 1 });
    expect(second.errors.some((error) => error.error.includes('Duplicate plugin id "fixture-good-plugin"'))).toBe(true);
  });
});
