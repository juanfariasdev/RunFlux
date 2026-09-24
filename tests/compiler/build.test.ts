import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildSync } from 'esbuild';
import { expect, it } from 'vitest';
import { compileWorkflow } from '../../packages/compiler/src/compiler';
import { loadPlugin } from '../plugins/helpers';

it('exports a backend that builds and passes its own strict TypeScript configuration', async () => {
  const ids = ['trigger-webhook', 'condition-if', 'condition-switch', 'filter', 'set', 'code-javascript', 'http-output', 'log-output', 'trigger-cron', 'trigger-manual-example', 'database-query'];
  const plugins = new Map(await Promise.all(ids.map(async (id) => [id, await loadPlugin(id)] as const)));
  const result = await compileWorkflow({ targetPlatform: 'local', projectName: "Customer's backend", workflow: {
    id: 'build', name: 'Build', nodes: ids.map((id) => ({ id, pluginId: id, pluginVersion: '1.0.0', position: { x: 0, y: 0 }, parameters: {} })), connections: [],
  } }, (id) => plugins.get(id));
  expect(result.status).toBe('success');
  if (result.status !== 'success') return;
  const directory = mkdtempSync(join(tmpdir(), 'runflux-generated-'));
  try {
    for (const file of result.files) { const path = join(directory, file.path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, file.content); }
    symlinkSync(resolve('node_modules'), join(directory, 'node_modules'));
    const build = buildSync({ absWorkingDir: directory, entryPoints: ['src/server.ts', 'src/run.ts', 'src/run-cron.ts'], bundle: true, packages: 'external', platform: 'node', format: 'esm', outdir: 'dist', write: false });
    expect(build.errors).toEqual([]);
    let diagnostics = '';
    try { execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--noEmit', '--project', join(directory, 'tsconfig.json')], { encoding: 'utf8', stdio: 'pipe' }); }
    catch (error) { diagnostics = String((error as { stdout?: string }).stdout); }
    expect(diagnostics).toBe('');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
