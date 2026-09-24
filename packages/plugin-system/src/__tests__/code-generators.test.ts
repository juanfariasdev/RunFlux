import { describe, it, expect } from 'vitest';
import {
  generateConditionIfCode,
  generateConditionSwitchCode,
  generateFilterCode,
  generateSetCode,
  generateHttpOutputCode,
  generateCodeJavascriptCode,
} from '../code-generators';

describe('Componentized Code Generators (TDD)', () => {
  describe('generateCodeJavascriptCode', () => {
    it('generates executable code-javascript runner with standardized extractContext', () => {
      const code = generateCodeJavascriptCode({
        code: 'return { doubled: $json.count * 2, fromNode: $node["Step1"].json };',
      });

      const stripped = code
        .replace(/export (async )?function/g, '$1function')
        .replace(/\?:\s*any/g, '')
        .replace(/:\s*any/g, '');
      const factory = new Function(`${stripped}; return { run };`);

      const { run } = factory();

      const context = {
        $node: { Step1: { json: { ready: true } } },
      };
      return expect(run({ count: 10 }, context)).resolves.toEqual({
        doubled: 20,
        fromNode: { ready: true },
      });
    });
  });

  describe('generateConditionIfCode', () => {

    it('generates executable code matching true branch', () => {
      const code = generateConditionIfCode({
        combinator: 'and',
        conditions: [{ leftValue: '{{ $json.status }}', operator: 'equals', rightValue: 'active' }],
      });

      const stripped = code.replace(/export (async )?function/g, '$1function');
      const factory = new Function(`${stripped}; return { run };`);
      const { run } = factory();

      const result = run({ status: 'active' });
      expect(result).toEqual({ value: { status: 'active' }, activeOutput: 'true' });

      const falseResult = run({ status: 'inactive' });
      expect(falseResult).toEqual({ value: { status: 'inactive' }, activeOutput: 'false' });
    });

    it('strictly separates types: "1" is not equal to 1 in generated condition code', () => {
      const code = generateConditionIfCode({
        conditions: [{ leftValue: '{{ $json.id }}', operator: 'equals', rightValue: 1 }],
      });

      const stripped = code.replace(/export (async )?function/g, '$1function');
      const factory = new Function(`${stripped}; return { run };`);
      const { run } = factory();

      // String '1' should not equal number 1
      const res = run({ id: '1' });
      expect(res.activeOutput).toBe('false');

      // Number 1 matches number 1
      const res2 = run({ id: 1 });
      expect(res2.activeOutput).toBe('true');
    });
  });

  describe('generateConditionSwitchCode', () => {
    it('generates executable switch code routing to matching rule output', () => {
      const code = generateConditionSwitchCode({
        rules: [
          { combinator: 'and', conditions: [{ leftValue: '{{ $json.tier }}', operator: 'equals', rightValue: 'gold' }] },
          { combinator: 'and', conditions: [{ leftValue: '{{ $json.tier }}', operator: 'equals', rightValue: 'silver' }] },
        ],
        fallbackEnabled: true,
        ruleOutputs: ['output1', 'output2', 'output3', 'output4', 'output5'],
      });

      const stripped = code.replace(/export (async )?function/g, '$1function');
      const factory = new Function(`${stripped}; return { run };`);
      const { run } = factory();

      expect(run({ tier: 'gold' })).toEqual({ value: { tier: 'gold' }, activeOutput: 'output1' });
      expect(run({ tier: 'silver' })).toEqual({ value: { tier: 'silver' }, activeOutput: 'output2' });
      expect(run({ tier: 'bronze' })).toEqual({ value: { tier: 'bronze' }, activeOutput: 'fallback' });
    });
  });

  describe('generateFilterCode', () => {
    it('generates filter code activating main only on match', () => {
      const code = generateFilterCode({
        conditions: [{ leftValue: '{{ $json.age }}', operator: 'greaterThan', rightValue: 18 }],
      });

      const stripped = code.replace(/export (async )?function/g, '$1function');
      const factory = new Function(`${stripped}; return { run };`);
      const { run } = factory();

      expect(run({ age: 25 })).toEqual({ value: { age: 25 }, activeOutput: 'main' });
      expect(run({ age: 16 })).toEqual({ value: { age: 16 }, activeOutput: null });
    });
  });

  describe('generateSetCode', () => {
    it('generates set code composing typed fields with normalizeFieldValue', () => {
      const code = generateSetCode({
        fields: [
          { name: 'fullName', value: '{{ $json.first }} {{ $json.last }}', type: 'string' },
          { name: 'score', value: '100', type: 'number' },
          { name: 'isAdmin', value: 'true', type: 'boolean' },
        ],
        includeOtherFields: true,
      });

      const stripped = code.replace(/export (async )?function/g, '$1function');
      const factory = new Function(`${stripped}; return { run };`);
      const { run } = factory();

      const result = run({ first: 'John', last: 'Doe', original: 'kept' });
      expect(result).toEqual({
        first: 'John',
        last: 'Doe',
        original: 'kept',
        fullName: 'John Doe',
        score: 100,
        isAdmin: true,
      });
    });
  });

  describe('generateHttpOutputCode', () => {
    it('generates valid http output template with extractContext and resolveValue', () => {
      const code = generateHttpOutputCode({
        method: 'POST',
        url: 'https://api.example.com/data',
        headers: { Authorization: 'Bearer {{ $env.TOKEN }}' },
        body: { query: '{{ $json.q }}' },
      });

      expect(code).toContain('export async function run($json, context)');
      expect(code).toContain('extractContext');
      expect(code).toContain('https://api.example.com/data');
    });
  });
});
