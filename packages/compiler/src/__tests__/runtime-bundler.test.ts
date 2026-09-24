import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { RUNTIME_ENTRIES, RuntimeBundleError, RuntimeBundler, VENDOR_DIRECTORY } from '../bundling/runtime-bundler.js';
import type { GeneratedFile } from '../types.js';
import { fixturePlugins } from './fixtures/plugins.js';

const bundler = new RuntimeBundler();
const directories: string[] = [];
afterAll(() => Promise.all(directories.map((directory) => fs.rm(directory, { recursive: true, force: true }))));

async function writeVendor(files: GeneratedFile[]): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'runflux-vendor-'));
  directories.push(directory);
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(directory, file.path)), { recursive: true });
    await fs.writeFile(path.join(directory, file.path), file.content);
  }
  return path.join(directory, VENDOR_DIRECTORY);
}

describe('RuntimeBundler', () => {
  it('bundles the requested entries and maps each plugin id to its runtime definition', async () => {
    const files = await bundler.bundle({ entries: [RUNTIME_ENTRIES.core, RUNTIME_ENTRIES.cli], plugins: [{ id: 'echo', runtimeModule: fixturePlugins.echo.runtimeModule }], external: [] });
    const vendor = await writeVendor(files);
    const runtime = await import(pathToFileURL(path.join(vendor, 'index.js')).href);
    const { plugins } = await import(pathToFileURL(path.join(vendor, 'plugins.js')).href);
    expect(Object.keys(plugins)).toEqual(['echo']);
    const engine = runtime.WorkflowEngine.fromDocument({
      schemaVersion: 1, id: 'w', name: 'W', connections: [], triggers: { http: [], schedules: [] },
      nodes: [{ id: 'n', pluginId: 'echo', trigger: true, outputs: ['main'], parameters: { prefix: '> ' }, literalParameters: [] }],
    }, plugins);
    expect((await engine.run({ payload: { id: 1 } })).result()).toBe('> {"id":1}');
    expect(files.every((file) => file.path.startsWith(`${VENDOR_DIRECTORY}/`) && file.type === 'runtime')).toBe(true);
    expect(files.some((file) => file.path.endsWith('/express.js'))).toBe(false);
  });

  it('shares one runtime between the entries and the plugins', async () => {
    const files = await bundler.bundle({ entries: [RUNTIME_ENTRIES.core], plugins: [{ id: 'echo', runtimeModule: fixturePlugins.echo.runtimeModule }], external: [] });
    const nodeOutputClasses = files.filter((file) => /class NodeOutput\b/.test(file.content));
    expect(nodeOutputClasses).toHaveLength(1);
  });

  it('describes its exports and ships the type declarations without tests or the testing harness', async () => {
    const files = await bundler.bundle({ entries: [RUNTIME_ENTRIES.core, RUNTIME_ENTRIES.express], plugins: [], external: ['express', 'cors'] });
    const manifest = JSON.parse(files.find((file) => file.path === `${VENDOR_DIRECTORY}/package.json`)!.content);
    expect(manifest).toMatchObject({ name: '@runflux/runtime', type: 'module', main: './index.js' });
    expect(manifest.exports).toEqual({
      '.': { types: './types/index.d.ts', default: './index.js' },
      './express': { types: './types/hosts/express/index.d.ts', default: './express.js' },
      './plugins': { types: './types/plugins.d.ts', default: './plugins.js' },
    });
    const declarations = files.filter((file) => file.path.includes('/types/')).map((file) => file.path);
    expect(declarations).toEqual(expect.arrayContaining([`${VENDOR_DIRECTORY}/types/index.d.ts`, `${VENDOR_DIRECTORY}/types/plugins.d.ts`, `${VENDOR_DIRECTORY}/types/hosts/express/index.d.ts`]));
    expect(declarations.some((file) => /__tests__|\/testing\//.test(file))).toBe(false);
    expect(files.find((file) => file.path.endsWith('/express.js'))!.content).toMatch(/from "express"/);
  });

  it('refuses plugin runtimes that import editor packages', async () => {
    await expect(bundler.bundle({ entries: [RUNTIME_ENTRIES.core], plugins: [{ id: 'editorOnly', runtimeModule: fixturePlugins.editorOnly.runtimeModule }], external: [] }))
      .rejects.toThrow(/must not import "@runflux\/plugin-system\/manifest-validator"/);
  });

  it('reports runtimes that cannot be resolved', async () => {
    const bundle = bundler.bundle({ entries: [RUNTIME_ENTRIES.core], plugins: [{ id: 'broken', runtimeModule: fixturePlugins.broken.runtimeModule }], external: [] });
    await expect(bundle).rejects.toBeInstanceOf(RuntimeBundleError);
    await expect(bundler.bundle({ entries: [RUNTIME_ENTRIES.core], plugins: [{ id: 'broken', runtimeModule: fixturePlugins.broken.runtimeModule }], external: [] }))
      .rejects.toThrow(/missing-module\.js/);
  });

  describe('with a copy of the runtime package', () => {
    const runtimePackage = path.resolve(new URL('../../../runtime', import.meta.url).pathname);
    async function copyRuntime(): Promise<string> {
      const copy = await fs.mkdtemp(path.join(os.tmpdir(), 'runflux-runtime-package-'));
      directories.push(copy);
      for (const entry of ['src', 'dist', 'package.json', 'tsconfig.tsbuildinfo']) {
        await fs.cp(path.join(runtimePackage, entry), path.join(copy, entry), { recursive: true, preserveTimestamps: true });
      }
      return copy;
    }
    const typesOf = async (runtime: string) => (await new RuntimeBundler(runtime).bundle({ entries: [RUNTIME_ENTRIES.core], plugins: [], external: [] }))
      .filter((file) => file.path.includes('/types/'))
      .map((file) => file.path.slice(`${VENDOR_DIRECTORY}/types/`.length));

    it('ships no declaration left over from a source that was deleted', async () => {
      const runtime = await copyRuntime();
      await fs.writeFile(path.join(runtime, 'dist', 'removed-module.d.ts'), 'export declare const gone: true;\n');
      const types = await typesOf(runtime);
      expect(types).toContain('index.d.ts');
      expect(types).not.toContain('removed-module.d.ts');
    });

    it('asks for a build when a declaration is older than its source', async () => {
      const runtime = await copyRuntime();
      const later = new Date(Date.now() + 60_000);
      await fs.utimes(path.join(runtime, 'src', 'values.ts'), later, later);
      await expect(typesOf(runtime)).rejects.toThrow('Runtime type declarations are older than src/values.ts; run "npm run build:node -w @runflux/runtime"');
    });

    it('reads the dependency versions the runtime declares', async () => {
      const runtime = await copyRuntime();
      const manifest = JSON.parse(await fs.readFile(path.join(runtime, 'package.json'), 'utf8'));
      expect(new RuntimeBundler(runtime).dependencyVersions(['express', 'node-cron'])).toEqual({ express: manifest.dependencies.express, 'node-cron': manifest.dependencies['node-cron'] });
      expect(() => new RuntimeBundler(runtime).dependencyVersions(['left-pad'])).toThrow('@runflux/runtime does not declare the dependency "left-pad"');
    });
  });

  it('asks for a build when the type declarations are missing', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'runflux-runtime-package-'));
    directories.push(empty);
    await fs.cp(path.resolve(new URL('../../../runtime/src', import.meta.url).pathname), path.join(empty, 'src'), { recursive: true });
    await expect(new RuntimeBundler(empty).bundle({ entries: [RUNTIME_ENTRIES.core], plugins: [], external: [] }))
      .rejects.toThrow('Runtime type declarations are missing');
  });
});
