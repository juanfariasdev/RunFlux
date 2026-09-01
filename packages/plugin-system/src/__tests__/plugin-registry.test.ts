import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DuplicatePluginIdError, PluginRegistry } from '../plugin-registry';
import type { DiscoveredPlugin } from '../types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makePlugin(overrides: Partial<DiscoveredPlugin> = {}): DiscoveredPlugin {
  return {
    manifest: {
      id: 'action-example',
      name: 'Example Action',
      category: 'action',
      version: '1.0.0',
      parameters: [],
      supportedPlatforms: ['local'],
    },
    generators: {
      local: () => ({ files: [{ path: 'index.ts', content: '// generated' }], infra: [] }),
    },
    sourcePath: '/plugins/action-example',
    ...overrides,
  };
}

describe('PluginRegistry.register', () => {
  it('registers a new plugin', () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin());
    expect(registry.listManifests()).toHaveLength(1);
  });

  it('rejects a second plugin with the same id (EC-02)', () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin({ sourcePath: '/plugins/first' }));

    expect(() => registry.register(makePlugin({ sourcePath: '/plugins/second' }))).toThrow(
      DuplicatePluginIdError,
    );
    // the original registration must survive the rejected attempt
    expect(registry.listManifests()).toHaveLength(1);
  });
});

describe('PluginRegistry.listManifests / getManifest', () => {
  it('returns an empty list when nothing is registered', () => {
    const registry = new PluginRegistry();
    expect(registry.listManifests()).toEqual([]);
  });

  it('returns undefined from getManifest for an unregistered id', () => {
    const registry = new PluginRegistry();
    expect(registry.getManifest('does-not-exist')).toBeUndefined();
  });

  it('returns the manifest for a registered id', () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin());
    expect(registry.getManifest('action-example')?.version).toBe('1.0.0');
  });
});

describe('PluginRegistry.resolveGenerator', () => {
  it('resolves the generator for a supported platform', () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin());

    const generator = registry.resolveGenerator('action-example', 'local');
    const artifact = generator({}, { workflowId: 'wf-1', nodeId: 'n1' });
    expect(artifact.files[0].path).toBe('index.ts');
  });

  it('throws a clear error when the platform is not supported', () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin());

    expect(() => registry.resolveGenerator('action-example', 'aws')).toThrowError(
      /does not support platform "aws"/i,
    );
  });

  it('throws a clear error when the plugin id is unknown', () => {
    const registry = new PluginRegistry();
    expect(() => registry.resolveGenerator('does-not-exist', 'local')).toThrowError(
      /unknown plugin/i,
    );
  });
});

describe('PluginRegistry.discover', () => {
  it('aggregates plugins found by directory scanning and reports errors without throwing', async () => {
    const registry = new PluginRegistry();
    const fixturesDir = path.join(__dirname, 'fixtures', 'discovery-mixed');
    const logs: string[] = [];

    const summary = await registry.discover({
      pluginDirectories: [fixturesDir],
      onLog: (msg) => logs.push(msg),
    });

    expect(summary.discovered).toBe(1);
    expect(summary.errors.some((e) => e.path.includes('bad-plugin'))).toBe(true);
    expect(registry.getManifest('fixture-good-plugin')).toBeDefined();
    expect(logs.length).toBeGreaterThan(0);
  });

  it('returns zero discovered and zero errors when no directories/node_modules are given', async () => {
    const registry = new PluginRegistry();
    const summary = await registry.discover();
    expect(summary).toEqual({ discovered: 0, rejected: 0, errors: [] });
  });

  it('counts a duplicate id found during discover() as rejected, not a thrown exception', async () => {
    const registry = new PluginRegistry();
    const fixturesDir = path.join(__dirname, 'fixtures', 'discovery-mixed');

    await registry.discover({ pluginDirectories: [fixturesDir] });
    // discovering the very same directory again re-finds "fixture-good-plugin",
    // which is now a duplicate of the one already registered above.
    const secondSummary = await registry.discover({ pluginDirectories: [fixturesDir] });

    expect(secondSummary.rejected).toBe(1);
    expect(secondSummary.discovered).toBe(0);
  });
});
