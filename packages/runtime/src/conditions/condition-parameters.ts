import type { ParameterReader } from '../parameters/parameter-reader.js';
import type { Combinator, Condition, ConditionGroup } from './condition-evaluator.js';
import { isConditionOperator } from './condition-operators.js';

const COMBINATORS: readonly Combinator[] = ['and', 'or'];

/** Reads the `and`/`or` combinator parameter of a condition list. */
export function readCombinator(parameters: ParameterReader, name: string): Combinator {
  return parameters.choice(name, COMBINATORS, 'and');
}

/** Reads a list of condition rows (`leftValue`, `operator`, `rightValue`). */
export function readConditions(parameters: ParameterReader, name: string): Condition[] {
  return parseConditions(parameters.list(name), (problem) => parameters.error(name, problem));
}

/** Reads a list of condition groups, each with its own combinator (switch rules). */
export function readConditionGroups(parameters: ParameterReader, name: string): ConditionGroup[] {
  return parameters.list(name).map((row, index) => {
    const fail = (problem: string) => parameters.error(name, `rule ${index + 1} ${problem}`);
    if (!isRecord(row)) throw fail('must be an object');
    const combinator = row.combinator ?? 'and';
    if (!COMBINATORS.includes(combinator as Combinator)) throw fail('must combine its conditions with "and" or "or"');
    const conditions = row.conditions ?? [];
    if (!Array.isArray(conditions)) throw fail('must have a list of conditions');
    return { combinator: combinator as Combinator, conditions: parseConditions(conditions, (problem) => fail(`condition ${problem}`)) };
  });
}

function parseConditions(rows: readonly unknown[], fail: (problem: string) => Error): Condition[] {
  return rows.map((row, index) => {
    if (!isRecord(row)) throw fail(`row ${index + 1} must be an object`);
    const operator = row.operator ?? 'equals';
    if (typeof operator !== 'string' || !isConditionOperator(operator)) {
      throw fail(`row ${index + 1} uses unknown operator "${String(operator)}"`);
    }
    return { leftValue: row.leftValue, operator, rightValue: row.rightValue };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
