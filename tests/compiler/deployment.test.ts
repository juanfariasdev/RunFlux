import { expect, it, vi } from 'vitest';
import { loadGeneratedModule } from '@runflux/plugin-system/testing';
import { compileWorkflow } from '../../packages/compiler/src/compiler';
import { loadPlugin } from '../plugins/helpers';

it.each(['local', 'aws'] as const)('exports every webhook secret and database connection setting (%s)', async (targetPlatform) => {
  const webhook = await loadPlugin('trigger-webhook');
  const database = await loadPlugin('database-query');
  const result = await compileWorkflow({ targetPlatform, projectName: 'Environment', workflow: {
    id: 'env', name: 'Environment', nodes: [
      { id: 'first', pluginId: 'trigger-webhook', parameters: { path: '/first', authentication: 'secret', secretEnvVar: 'FIRST_SECRET' } },
      { id: 'second', pluginId: 'trigger-webhook', parameters: { path: '/second', authentication: 'secret', secretEnvVar: 'SECOND_SECRET' } },
      { id: 'database', pluginId: 'database-query', parameters: { connectionEnvVar: 'ORDERS_DATABASE_URL' } },
    ].map((node) => ({ ...node, pluginVersion: '1.0.0', position: { x: 0, y: 0 } })), connections: [],
    settings: { envVars: [{ key: 'SECOND_SECRET', value: 'configured' }] },
  } }, (id) => id === 'database-query' ? database : webhook);
  if (result.status !== 'success') throw new Error('Compilation failed');
  const file = result.files.find((file) => file.path === (targetPlatform === 'local' ? '.env.example' : 'lib/workflow-stack.ts'))!.content;
  for (const key of ['FIRST_SECRET', 'SECOND_SECRET', 'ORDERS_DATABASE_URL']) {
    expect(file).toContain(targetPlatform === 'local' ? `${key}=` : `${JSON.stringify(key)}:`);
  }
  if (targetPlatform === 'local') expect(file.match(/^SECOND_SECRET=/gm)).toHaveLength(1);
});

it('registers every local cron and directs each firing to its own workflow branch', async () => {
  const plugin = await loadPlugin('trigger-cron');
  const result = await compileWorkflow({ targetPlatform: 'local', projectName: 'Schedules', workflow: {
    id: 'schedules', name: 'Schedules', nodes: ['first', 'second'].map((id, i) => ({
      id, pluginId: 'trigger-cron', pluginVersion: '1.0.0', position: { x: 0, y: 0 },
      parameters: { expression: i ? '0 9 * * 1-5' : '*/15 * * * *', timezone: 'America/Sao_Paulo' },
    })), connections: [],
  } }, () => plugin);
  if (result.status !== 'success') throw new Error('Compilation failed');
  const scheduler = result.files.find((file) => file.path === 'src/schedules.ts');
  expect(scheduler).toBeDefined();
  const callbacks: Array<() => Promise<void>> = [];
  const schedule = vi.fn((_expression: string, callback: () => Promise<void>) => { callbacks.push(callback); return { stop() {} }; });
  const runWorkflow = vi.fn(async () => ({ success: true }));
  loadGeneratedModule(scheduler!.content, { 'node-cron': { schedule }, './runner.js': { runWorkflow } }).startSchedules();
  expect(schedule).toHaveBeenCalledTimes(2);
  for (const callback of callbacks) await callback();
  expect(runWorkflow.mock.calls.map((args: unknown[]) => args[1])).toEqual(['first', 'second']);
});

it('exports deployable Lambda packaging and preserves each cron trigger timezone and target', async () => {
  const plugin = await loadPlugin('trigger-cron');
  const result = await compileWorkflow({ targetPlatform: 'aws', projectName: "Customer's schedules", workflow: {
    id: 'schedules', name: 'Schedules', nodes: ['first', 'second'].map((id, i) => ({
      id, pluginId: 'trigger-cron', pluginVersion: '1.0.0', position: { x: 0, y: 0 },
      parameters: { expression: i ? '0 9 * * 1-5' : '*/15 * * * *', timezone: 'America/Sao_Paulo' },
    })), connections: [],
  } }, () => plugin);
  if (result.status !== 'success') throw new Error('Compilation failed');
  const stack = result.files.find((file) => file.path === 'lib/workflow-stack.ts')!.content;
  expect(stack).toContain("handler: 'handler.handler'");
  expect(stack).toContain('cron(*/15 * * * ? *)');
  expect(stack).toContain('cron(0 9 ? * 2-6 *)');
  expect(stack).toContain('scheduleExpressionTimezone: "America/Sao_Paulo"');
  expect(stack).toContain('runfluxTriggerId');
  expect(stack).not.toContain('__dirname');
  const pkg = JSON.parse(result.files.find((file) => file.path === 'package.json')!.content);
  expect(pkg.devDependencies.tsx).toBeDefined();
  expect(pkg.scripts.deploy).toContain('npm run package');
});

it('rejects schedules that AWS cannot preserve instead of exporting invalid infrastructure', async () => {
  const plugin = await loadPlugin('trigger-cron');
  const result = await compileWorkflow({ targetPlatform: 'aws', projectName: 'Invalid schedule', workflow: {
    id: 'schedule', name: 'Schedule', nodes: [{ id: 'cron', pluginId: 'trigger-cron', pluginVersion: '1.0.0', position: { x: 0, y: 0 }, parameters: { expression: '0 0 1 * 1' } }], connections: [],
  } }, () => plugin);
  expect(result).toMatchObject({ status: 'failed', error: { code: 'INVALID_WORKFLOW' } });
});
