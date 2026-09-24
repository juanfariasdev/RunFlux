import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import JSZip from 'jszip';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { CompilerService } from '../compiler-service';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const PASS_THROUGH = `export default {
  parseParameters: () => ({}),
  createHandler: () => ({ execute: ({ input }) => ({ value: input, activeOutput: 'main' }) }),
};`;

/** A trigger plugin in a temporary plugins directory; `runtime` is its runtime module's source. */
function fixture(runtime: string, platforms: string[] = ['local']) {
  const directory = mkdtempSync(join(tmpdir(), 'runflux-compiler-'));
  directories.push(directory);
  const plugins = join(directory, 'plugins');
  const plugin = join(plugins, 'example');
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(plugin, 'package.json'), '{"type":"module"}');
  writeFileSync(join(plugin, 'index.js'), `
    export const manifest = { id: 'example', name: 'Example', version: '1.0.0', category: 'trigger', parameters: [], supportedPlatforms: ${JSON.stringify(platforms)} };
    export const runtimeModule = new URL('./runtime.js', import.meta.url);
  `);
  writeFileSync(join(plugin, 'runtime.js'), runtime);
  return new CompilerService(plugins, join(directory, 'output'));
}

const workflow = { id: 'test', name: 'Test', nodes: [{ id: 'n1', pluginId: 'example', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } }], connections: [] };

it('honors plugin target support instead of inventing an AWS generator', async () => {
  const service = fixture(PASS_THROUGH);
  await expect(service.compile({ workflow, targetPlatform: 'aws' })).rejects.toMatchObject({ code: 'INCOMPATIBLE_NODES' });
});

it('treats a plugin whose runtime cannot load as not installed', async () => {
  const service = fixture(`import { missing } from './missing-module.js';\n${PASS_THROUGH}`);
  await expect(service.compile({ workflow, targetPlatform: 'local' })).rejects.toMatchObject({ code: 'INCOMPATIBLE_NODES' });
});

it('reports a runtime that cannot be bundled instead of returning a successful download', async () => {
  const service = fixture(`${PASS_THROUGH}\nexport const later = () => import('./missing-module.js');`);
  await expect(service.compile({ workflow, targetPlatform: 'local' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('missing-module.js') });
});

it('downloads a complete standalone project with dependencies, source and compiled entrypoints', async () => {
  const service = fixture(PASS_THROUGH);
  const result = await service.compile({ workflow, targetPlatform: 'local' });
  const zip = await JSZip.loadAsync(readFileSync(join(result.outputDirectory, result.zipFilename)));
  expect(Object.keys(zip.files)).toEqual(expect.arrayContaining([
    'package.json', 'README.md', 'src/server.ts', 'src/workflow.json', 'dist/server.mjs', 'runflux-build.json',
    'vendor/runflux-runtime/package.json', 'vendor/runflux-runtime/plugins.js', 'vendor/runflux-runtime/types/index.d.ts',
  ]));
  const functionZip = await JSZip.loadAsync(readFileSync(join(result.outputDirectory, 'compiled', 'function.zip')));
  expect(Object.keys(functionZip.files)).toEqual(expect.arrayContaining(['server.mjs', 'run.mjs']));
});

it('recompiles without carrying removed entrypoints and bundles into the new download', async () => {
  const service = fixture(PASS_THROUGH);
  const first = await service.compile({ workflow, targetPlatform: 'local' });
  writeFileSync(join(first.outputDirectory, 'src/run-cron.ts'), 'export const removed = true;');
  writeFileSync(join(first.outputDirectory, 'dist/removed.mjs'), 'export const removed = true;');
  const next = await service.compile({ workflow, targetPlatform: 'local' });
  const zip = await JSZip.loadAsync(readFileSync(join(next.outputDirectory, next.zipFilename)));
  expect(Object.keys(zip.files)).not.toContain('dist/removed.mjs');
  expect(Object.keys(zip.files)).not.toContain('dist/run-cron.mjs');
});

it('serves the download of the requested target when the same workflow was compiled for local and AWS', async () => {
  const service = fixture(PASS_THROUGH, ['local', 'aws']);
  const aws = await service.compile({ workflow, targetPlatform: 'aws' });
  const local = await service.compile({ workflow, targetPlatform: 'local' });
  expect(local.zipFilename).not.toBe(aws.zipFilename);
  expect(await service.findZipFile(local.zipFilename)).toBe(join(local.outputDirectory, local.zipFilename));
  expect(await service.findZipFile(aws.zipFilename)).toBe(join(aws.outputDirectory, aws.zipFilename));
});

it('rejects download paths outside the generated output', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runflux-download-'));
  directories.push(directory);
  const output = join(directory, 'output');
  mkdirSync(output);
  writeFileSync(join(directory, 'private.zip'), 'private');
  expect(await new CompilerService(undefined, output).findZipFile('../private.zip')).toBeNull();
});
