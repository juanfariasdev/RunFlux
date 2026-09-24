import { validateManifest } from '@runflux/plugin-system/manifest-validator';
import { executeNode } from '@runflux/runtime/testing';
import { describe, expect, it } from 'vitest';
import { manifest } from '../index';
import condition from '../runtime';

const run = (parameters: Record<string, unknown>, input: unknown = {}) =>
  executeNode(condition, { parameters, input, outputs: manifest.outputs, pluginId: 'condition-if' });

describe('condition-if', () => {
  it('declares a valid manifest with true and false outputs', () => {
    expect(validateManifest(manifest).success).toBe(true);
    expect(manifest.outputs).toEqual(['true', 'false']);
  });

  it('routes the unchanged input to true or false', async () => {
    const input = { amount: 250 };
    const conditions = [{ leftValue: '{{ $json.amount }}', operator: 'greaterThan', rightValue: 100 }];
    expect(await run({ conditions }, input)).toMatchObject({ activeOutput: 'true', output: input });
    expect(await run({ conditions }, { amount: 10 })).toMatchObject({ activeOutput: 'false', output: { amount: 10 } });
  });

  it('combines conditions with and/or', async () => {
    const conditions = [
      { leftValue: '{{ $json.a }}', operator: 'equals', rightValue: 1 },
      { leftValue: '{{ $json.b }}', operator: 'equals', rightValue: 1 },
    ];
    expect((await run({ conditions, combinator: 'and' }, { a: 1, b: 2 })).activeOutput).toBe('false');
    expect((await run({ conditions, combinator: 'or' }, { a: 1, b: 2 })).activeOutput).toBe('true');
  });

  it('holds without conditions', async () => {
    expect((await run({})).activeOutput).toBe('true');
  });

  it('compares values without coercing types', async () => {
    const date = new Date('2026-01-01');
    expect((await run({ conditions: [{ leftValue: '{{ $json.a }}', operator: 'equals', rightValue: '{{ $json.b }}' }] }, { a: date, b: new Date('2026-01-02') })).activeOutput).toBe('false');
    expect((await run({ conditions: [{ leftValue: '1', operator: 'equals', rightValue: 1 }] })).activeOutput).toBe('false');
  });

  it.each([
    [{ conditions: [{ operator: 'between' }] }, 'condition-if: parameter "conditions" row 1 uses unknown operator "between"'],
    [{ conditions: 'amount > 1' }, 'condition-if: parameter "conditions" must be a list'],
    [{ combinator: 'xor' }, 'condition-if: parameter "combinator" must be one of "and", "or"'],
  ])('reports invalid configuration %j', async (parameters, message) => {
    expect((await run(parameters)).error).toBe(message);
  });
});
