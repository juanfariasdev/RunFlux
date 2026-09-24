import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  const output = join(directory, 'output');
  return { service: new CompilerService(plugins, output), output, plugin };
}

const workflow = { id: 'test', name: 'Test', nodes: [{ id: 'n1', pluginId: 'example', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } }], connections: [] };
const zipEntries = async (file: string) => Object.keys((await JSZip.loadAsync(readFileSync(file))).files);

it('honors plugin target support instead of inventing an AWS generator', async () => {
  const { service } = fixture(PASS_THROUGH);
  await expect(service.compile({ workflow, targetPlatform: 'aws' })).rejects.toMatchObject({ code: 'INCOMPATIBLE_NODES', status: 400 });
});

it('treats a plugin whose runtime cannot load as not installed', async () => {
  const { service } = fixture(`import { missing } from './missing-module.js';\n${PASS_THROUGH}`);
  await expect(service.compile({ workflow, targetPlatform: 'local' })).rejects.toMatchObject({ code: 'INCOMPATIBLE_NODES' });
});

it('reports a runtime that cannot be bundled as a server error with the compiler code', async () => {
  const { service } = fixture(`${PASS_THROUGH}\nexport const later = () => import('./missing-module.js');`);
  await expect(service.compile({ workflow, targetPlatform: 'local' })).rejects.toMatchObject({ code: 'GENERATOR_ERROR', status: 500, message: expect.stringContaining('missing-module.js') });
});

it.each([
  [{ workflow: undefined }, 'VALIDATION_ERROR', 'Invalid workflow: workflow: Required'],
  [{ workflow: { ...workflow, nodes: [{ id: 'n1' }] } }, 'VALIDATION_ERROR', 'Invalid workflow: nodes.0.pluginId: Required; nodes.0.position: Required'],
  [{ workflow, targetPlatform: 'gcp' }, 'UNSUPPORTED_TARGET', 'Plataforma alvo inválida: "gcp". Suportadas: local, aws.'],
  [{ workflow: { ...workflow, connections: [{ sourceNodeId: 'n1', targetNodeId: 'ghost' }] } }, 'INVALID_WORKFLOW', 'Connection n1 -> ghost references an unknown node'],
  [{ workflow, options: 'lean' }, 'VALIDATION_ERROR', 'Invalid compilation options: expected an object.'],
  [{ workflow, options: { includeCli: 'no' } }, 'VALIDATION_ERROR', 'Invalid compilation option: includeCli must be a boolean.'],
])('rejects the request %j with a client error', async (request, code, message) => {
  const { service } = fixture(PASS_THROUGH);
  await expect(service.compile(request as never)).rejects.toMatchObject({ code, message, status: 400 });
});

it('keeps the workflow settings, such as its environment variables', async () => {
  const { service } = fixture(PASS_THROUGH);
  const result = await service.compile({ workflow: { ...workflow, settings: { envVars: [{ key: 'API_KEY', value: 'k' }] } } as never, targetPlatform: 'local' });
  expect(readFileSync(join(result.outputDirectory, '.env.example'), 'utf8')).toContain('API_KEY=k');
});

it('downloads a complete standalone project with dependencies, source and compiled entrypoints', async () => {
  const { service } = fixture(PASS_THROUGH);
  const result = await service.compile({ workflow, targetPlatform: 'local' });
  expect(await zipEntries(join(result.outputDirectory, result.zipFilename))).toEqual(expect.arrayContaining([
    'package.json', 'README.md', 'src/server.ts', 'src/workflow.json', 'dist/server.mjs', 'runflux-build.json',
    'vendor/runflux-runtime/package.json', 'vendor/runflux-runtime/plugins.js', 'vendor/runflux-runtime/types/index.d.ts',
  ]));
  expect(existsSync(join(result.outputDirectory, 'function.zip'))).toBe(false);
  expect(result.downloadUrl).toBe(`/api/compiler/downloads/${result.compilationId}/Test-local.zip`);
});

it('can produce a lean local backend without the optional CLI runtime', async () => {
  const { service } = fixture(PASS_THROUGH);
  const result = await service.compile({ workflow, targetPlatform: 'local', options: { includeCli: false } });
  expect(result.manifest.build.entryPoints).toEqual(['src/server.ts']);
  expect(existsSync(join(result.outputDirectory, 'src', 'run.ts'))).toBe(false);
  expect(existsSync(join(result.outputDirectory, 'dist', 'run.mjs'))).toBe(false);
  expect(existsSync(join(result.outputDirectory, 'vendor', 'runflux-runtime', 'cli.js'))).toBe(false);
});

it('ignores the options a client may not set, such as the port and the variables', async () => {
  const { service } = fixture(PASS_THROUGH);
  const options = { port: 'abc', envVars: [{ key: 'INJECTED', value: 'x' }] };
  const result = await service.compile({ workflow: { ...workflow, settings: { envVars: [{ key: 'API_KEY', value: 'k' }] } } as never, targetPlatform: 'local', options: options as never });
  const env = readFileSync(join(result.outputDirectory, '.env.example'), 'utf8');
  expect(env).toContain('PORT=3000');
  expect(env).toContain('API_KEY=k');
  expect(env).not.toContain('INJECTED');
});

it('packages the AWS function on its own', async () => {
  const { service } = fixture(PASS_THROUGH, ['local', 'aws']);
  const result = await service.compile({ workflow, targetPlatform: 'aws' });
  expect(await zipEntries(join(result.outputDirectory, 'function.zip'))).toEqual(['handler.mjs']);
});

it('writes every compilation to a folder of its own and keeps only the latest of a project and target', async () => {
  const { service, output } = fixture(PASS_THROUGH, ['local', 'aws']);
  const first = await service.compile({ workflow, targetPlatform: 'local' });
  writeFileSync(join(first.outputDirectory, 'dist', 'removed.mjs'), 'export const removed = true;');
  const [second, aws] = await Promise.all([service.compile({ workflow, targetPlatform: 'local' }), service.compile({ workflow, targetPlatform: 'aws' })]);
  expect(second.outputDirectory).not.toBe(first.outputDirectory);
  expect(existsSync(first.outputDirectory)).toBe(false);
  expect(await zipEntries(join(second.outputDirectory, second.zipFilename))).not.toContain('dist/removed.mjs');
  expect(readdirSync(output).sort()).toEqual([aws.compilationId, second.compilationId].sort());
});

it('finds the download of a compilation, or the latest one with that file name, and nothing outside the output folder', async () => {
  const { service } = fixture(PASS_THROUGH, ['local', 'aws']);
  const aws = await service.compile({ workflow, targetPlatform: 'aws' });
  const local = await service.compile({ workflow, targetPlatform: 'local' });
  expect(local.zipFilename).not.toBe(aws.zipFilename);
  expect(await service.findZipFile(local.zipFilename, local.compilationId)).toBe(join(local.outputDirectory, local.zipFilename));
  expect(await service.findZipFile(aws.zipFilename)).toBe(join(aws.outputDirectory, aws.zipFilename));
  expect(await service.findZipFile(local.zipFilename, aws.compilationId)).toBeNull();
  expect(await service.findZipFile('../secret.zip')).toBeNull();
  expect(await service.findZipFile(local.zipFilename, '..')).toBeNull();
  expect(await service.findZipFile('function.txt', aws.compilationId)).toBeNull();
});

it('builds with the packages a plugin installs in its own node_modules', async () => {
  const { service, plugin } = fixture(`import { greeting } from 'plugin-only-package';\nexport default {
  parseParameters: () => ({}),
  createHandler: () => ({ execute: () => ({ value: greeting, activeOutput: 'main' }) }),
};`, ['local', 'aws']);
  mkdirSync(join(plugin, 'node_modules', 'plugin-only-package'), { recursive: true });
  writeFileSync(join(plugin, 'node_modules', 'plugin-only-package', 'package.json'), '{"name":"plugin-only-package","type":"module","main":"index.js"}');
  writeFileSync(join(plugin, 'node_modules', 'plugin-only-package', 'index.js'), "export const greeting = 'hi';");
  const result = await service.compile({ workflow, targetPlatform: 'aws' });
  expect(readFileSync(join(result.outputDirectory, 'dist', 'handler.mjs'), 'utf8')).toContain('"hi"');
});
