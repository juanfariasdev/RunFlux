import { validateManifest } from '@runflux/plugin-system/manifest-validator';
import { ParameterReader } from '@runflux/runtime';
import { executeNode } from '@runflux/runtime/testing';
import { describe, expect, it } from 'vitest';
import { deployment, manifest } from '../index';
import cron from '../runtime';

const clock = { now: () => new Date('2026-01-01T12:00:00.000Z') };
const reader = (values: Record<string, unknown>) => new ParameterReader(values, 'trigger-cron');

describe('trigger-cron', () => {
  it('declares a valid trigger manifest with a main output', () => {
    expect(validateManifest(manifest).success).toBe(true);
    expect(manifest.outputs).toEqual(['main']);
  });

  it('stamps the scheduled payload with the firing time and its schedule', async () => {
    const record = await executeNode(cron, { parameters: { expression: '0 * * * *', timezone: 'America/Sao_Paulo' }, input: { job: 'sync' }, services: { clock } });
    expect(record).toMatchObject({ activeOutput: 'main', output: { job: 'sync', triggeredAt: '2026-01-01T12:00:00.000Z', cronExpression: '0 * * * *', timezone: 'America/Sao_Paulo' } });
  });

  it('defaults to every fifteen minutes in UTC', async () => {
    expect((await executeNode(cron, { services: { clock } })).output).toEqual({ triggeredAt: '2026-01-01T12:00:00.000Z', cronExpression: '*/15 * * * *', timezone: 'UTC' });
  });

  it('declares its schedule for exported backends', () => {
    expect(deployment?.triggers?.(reader({ expression: '0 9 * * 1-5', timezone: 'UTC' }))).toEqual([{ kind: 'schedule', expression: '0 9 * * 1-5', timezone: 'UTC' }]);
    expect(deployment?.triggers?.(reader({}))).toEqual([{ kind: 'schedule', expression: '*/15 * * * *', timezone: 'UTC' }]);
  });

  it('rejects an expression that is not text', async () => {
    expect((await executeNode(cron, { parameters: { expression: 15 }, pluginId: 'trigger-cron' })).error).toBe('trigger-cron: parameter "expression" must be text');
  });
});
