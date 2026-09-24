import { validateManifest } from '@runflux/plugin-system/manifest-validator';
import { ObjectParameterReader } from '@runflux/runtime';
import { executeNode } from '@runflux/runtime/testing';
import { describe, expect, it } from 'vitest';
import { deployment, manifest } from '../index';
import cron from '../runtime';

const clock = { now: () => new Date('2026-01-01T12:00:00.000Z') };
const reader = (values: Record<string, unknown>) => new ObjectParameterReader(values, 'trigger-cron');

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

  it.each([
    [{ expression: '61 * * * *' }, 'trigger-cron: parameter "expression" is not a valid cron expression: minute "61" is not a value from 0 to 59'],
    [{ expression: '0 9 * *' }, 'trigger-cron: parameter "expression" is not a valid cron expression: expected 5 fields (minute hour day-of-month month day-of-week), got 4'],
    [{ timezone: 'Mars/Olympus' }, 'trigger-cron: parameter "timezone" "Mars/Olympus" is not a known IANA timezone'],
  ])('rejects the invalid schedule %j at run time and at compile time', async (parameters, message) => {
    expect((await executeNode(cron, { parameters, pluginId: 'trigger-cron' })).error).toBe(message);
    expect(() => deployment?.triggers?.(reader(parameters))).toThrow(message);
  });

  it('suggests only valid schedules and keeps the expression editable', () => {
    const expression = manifest.parameters.find((parameter) => parameter.name === 'expression')!;
    expect(expression.allowCustomOptions).toBe(true);
    for (const { value } of expression.options ?? []) {
      expect(deployment?.triggers?.(reader({ expression: value }))).toEqual([{ kind: 'schedule', expression: value, timezone: 'UTC' }]);
    }
  });
});
