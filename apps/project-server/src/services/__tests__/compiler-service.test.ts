import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import JSZip from 'jszip';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { CompilerService } from '../compiler-service';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture(source: string) {
  const directory = mkdtempSync(join(tmpdir(), 'runflux-compiler-'));
  directories.push(directory);
  const plugins = join(directory, 'plugins');
  const plugin = join(plugins, 'example');
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(plugin, 'package.json'), '{"type":"module"}');
  writeFileSync(join(plugin, 'index.js'), `
    export const manifest = { id: 'example', name: 'Example', version: '1.0.0', category: 'trigger', parameters: [], supportedPlatforms: ['local'] };
    export const generators = { local: () => ({ files: [{ path: 'example.ts', content: ${JSON.stringify(source)} }], infra: [] }) };
  `);
  return new CompilerService(plugins, join(directory, 'output'));
}

const workflow = { id: 'test', name: 'Test', nodes: [{ id: 'n1', pluginId: 'example', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } }], connections: [] };

it('honors plugin target support instead of inventing an AWS generator', async () => {
  const service = fixture('export function run(input: unknown) { return input; }');
  await expect(service.compile({ workflow, targetPlatform: 'aws' })).rejects.toMatchObject({ code: 'INCOMPATIBLE_NODES' });
});

it('reports build failures instead of returning a successful download', async () => {
  const service = fixture('import { missing } from "./missing-module.js"; export function run() { return missing(); }');
  await expect(service.compile({ workflow, targetPlatform: 'local' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
});

it('downloads a complete standalone project with dependencies, source and compiled entrypoints', async () => {
  const service = fixture('export function run(input: unknown) { return input; }');
  const result = await service.compile({ workflow, targetPlatform: 'local' });
  const zip = await JSZip.loadAsync(readFileSync(join(result.outputDirectory, result.zipFilename)));
  expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['package.json', 'README.md', 'src/server.ts', 'dist/server.mjs', 'runflux-build.json']));
});

it('recompiles without carrying removed entrypoints and bundles into the new download', async () => {
  const service = fixture('export function run(input: unknown) { return input; }');
  const first = await service.compile({ workflow, targetPlatform: 'local' });
  writeFileSync(join(first.outputDirectory, 'src/run-cron.ts'), 'export const removed = true;');
  writeFileSync(join(first.outputDirectory, 'dist/removed.mjs'), 'export const removed = true;');
  const next = await service.compile({ workflow, targetPlatform: 'local' });
  const zip = await JSZip.loadAsync(readFileSync(join(next.outputDirectory, next.zipFilename)));
  expect(Object.keys(zip.files)).not.toContain('dist/removed.mjs');
  expect(Object.keys(zip.files)).not.toContain('dist/run-cron.mjs');
});

it('rejects download paths outside the generated output', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runflux-download-'));
  directories.push(directory);
  const output = join(directory, 'output');
  mkdirSync(output);
  writeFileSync(join(directory, 'private.zip'), 'private');
  expect(await new CompilerService(undefined, output).findZipFile('../private.zip')).toBeNull();
});
