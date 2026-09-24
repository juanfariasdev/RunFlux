/** One output per rule, in rule order. Rules beyond these can never be taken. */
export const RULE_OUTPUTS = ['output1', 'output2', 'output3', 'output4', 'output5'] as const;

/** Taken when no rule holds and the fallback is enabled. */
export const FALLBACK_OUTPUT = 'fallback';
