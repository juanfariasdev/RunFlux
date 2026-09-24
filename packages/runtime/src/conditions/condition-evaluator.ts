import { CONDITION_OPERATORS, type ConditionOperator } from './condition-operators.js';

export type Combinator = 'and' | 'or';

export interface Condition {
  readonly leftValue: unknown;
  readonly operator: ConditionOperator;
  readonly rightValue?: unknown;
}

/** Conditions joined by one combinator, such as one rule of a switch. */
export interface ConditionGroup {
  readonly combinator: Combinator;
  readonly conditions: readonly Condition[];
}

export interface ConditionEvaluatorOptions {
  /** Whether values of different types never compare equal ("1" vs 1). Defaults to true. */
  readonly strict?: boolean;
}

export class ConditionEvaluator {
  private readonly strict: boolean;

  constructor(options: ConditionEvaluatorOptions = {}) {
    this.strict = options.strict ?? true;
  }

  test(condition: Condition): boolean {
    return CONDITION_OPERATORS[condition.operator](condition.leftValue, condition.rightValue, this.strict);
  }

  /** Whether the group holds. A group without conditions always holds. */
  matches(group: ConditionGroup): boolean {
    const results = group.conditions.map((condition) => this.test(condition));
    return group.combinator === 'or' ? results.length === 0 || results.some(Boolean) : results.every(Boolean);
  }

  /** Index of the first group that holds, or -1 when none does. */
  firstMatch(groups: readonly ConditionGroup[]): number {
    return groups.findIndex((group) => this.matches(group));
  }
}
