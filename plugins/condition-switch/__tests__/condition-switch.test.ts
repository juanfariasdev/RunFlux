import { validateManifest } from '@runflux/plugin-system/sdk';
import { executeNode } from '@runflux/runtime/testing';
import { describe, expect, it } from 'vitest';
import { manifest } from '../index';
import { RULE_OUTPUTS } from '../outputs';
import condition from '../runtime';

const run = (parameters: Record<string, unknown>, input: unknown = {}) =>
  executeNode(condition, { parameters, input, outputs: manifest.outputs, pluginId: 'condition-switch' });
const rule = (operator: string, rightValue: unknown, combinator = 'and') => ({ combinator, conditions: [{ leftValue: '{{ $json.tier }}', operator, rightValue }] });

describe('condition-switch', () => {
  it('declares one output per rule plus fallback', () => {
    expect(validateManifest(manifest).success).toBe(true);
    expect(manifest.outputs).toEqual([...RULE_OUTPUTS, 'fallback']);
  });

  it('routes to the output of the first rule that holds', async () => {
    const rules = [rule('equals', 'gold'), rule('startsWith', 's'), rule('startsWith', 'si')];
    expect(await run({ rules }, { tier: 'gold' })).toMatchObject({ activeOutput: 'output1', output: { tier: 'gold' } });
    expect((await run({ rules }, { tier: 'silver' })).activeOutput).toBe('output2');
  });

  it('uses the fallback when enabled and ends the branch otherwise', async () => {
    const rules = [rule('equals', 'gold')];
    expect((await run({ rules, fallbackEnabled: true }, { tier: 'bronze' })).activeOutput).toBe('fallback');
    expect(await run({ rules, fallbackEnabled: false }, { tier: 'bronze' })).toMatchObject({ activeOutput: null, error: null });
    expect((await run({}, {})).activeOutput).toBeNull();
  });

  it('holds a rule without conditions and never takes rules beyond the fifth', async () => {
    expect((await run({ rules: [{}] })).activeOutput).toBe('output1');
    const sixth = [...Array.from({ length: 5 }, () => rule('equals', 'never')), rule('equals', 'gold')];
    expect((await run({ rules: sixth, fallbackEnabled: true }, { tier: 'gold' })).activeOutput).toBe('fallback');
  });

  it('combines the conditions of each rule with its own combinator', async () => {
    const either = { combinator: 'or', conditions: [{ leftValue: 1, operator: 'equals', rightValue: 2 }, { leftValue: 1, operator: 'equals', rightValue: 1 }] };
    expect((await run({ rules: [either] })).activeOutput).toBe('output1');
  });

  it.each([
    [{ rules: [{ combinator: 'xor' }] }, 'condition-switch: parameter "rules" rule 1 must combine its conditions with "and" or "or"'],
    [{ rules: [{ conditions: [{ operator: 'nope' }] }] }, 'condition-switch: parameter "rules" rule 1 condition row 1 uses unknown operator "nope"'],
    [{ fallbackEnabled: 'yes' }, 'condition-switch: parameter "fallbackEnabled" must be true or false'],
  ])('reports invalid configuration %j', async (parameters, message) => {
    expect((await run(parameters)).error).toBe(message);
  });
});
