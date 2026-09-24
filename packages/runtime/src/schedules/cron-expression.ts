export class CronExpressionError extends Error {
  /** What is wrong, without the expression, e.g. `minute "61" is not a value from 0 to 59`. */
  readonly problem: string;

  constructor(expression: string, problem: string) {
    super(`Invalid cron expression "${expression}": ${problem}`);
    this.name = 'CronExpressionError';
    this.problem = problem;
  }
}

/** The kinds of field of a five-field Unix cron expression, in order. */
export type CronFieldName = 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek';

/** One item of a field list: `*`, a value or a range, with an optional step. */
export interface CronItem {
  /** Undefined for `*`. */
  readonly range?: { readonly start: number; readonly end: number };
  readonly step?: number;
  /** The item as written, e.g. `MON-FRI` or `*\/15`. */
  readonly text: string;
}

export interface CronField {
  readonly name: CronFieldName;
  readonly text: string;
  readonly items: readonly CronItem[];
  /** Whether the field is exactly `*`. */
  readonly any: boolean;
}

interface FieldRule {
  readonly name: CronFieldName;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly names?: ReadonlyMap<string, number>;
}

const MONTHS = new Map(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].map((name, index) => [name, index + 1]));
const WEEKDAYS = new Map(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((name, index) => [name, index]));

const RULES: readonly FieldRule[] = [
  { name: 'minute', label: 'minute', min: 0, max: 59 },
  { name: 'hour', label: 'hour', min: 0, max: 23 },
  { name: 'dayOfMonth', label: 'day of month', min: 1, max: 31 },
  { name: 'month', label: 'month', min: 1, max: 12, names: MONTHS },
  // 0 and 7 are both Sunday.
  { name: 'dayOfWeek', label: 'day of week', min: 0, max: 7, names: WEEKDAYS },
];

/**
 * A validated five-field Unix cron expression (minute, hour, day of month, month, day of week),
 * as node-cron runs it locally and the compiler translates it for other schedulers. Fields are
 * lists of `*`, values or ranges with optional steps; months and weekdays also accept names.
 */
export class CronExpression {
  readonly text: string;
  readonly fields: readonly CronField[];

  private constructor(text: string, fields: readonly CronField[]) {
    this.text = text;
    this.fields = fields;
  }

  static parse(expression: string): CronExpression {
    const text = expression.trim().replace(/\s+/g, ' ');
    const parts = text === '' ? [] : text.split(' ');
    if (parts.length !== RULES.length) {
      throw new CronExpressionError(expression, `expected ${RULES.length} fields (minute hour day-of-month month day-of-week), got ${parts.length}`);
    }
    return new CronExpression(text, parts.map((part, index) => parseField(expression, part, RULES[index])));
  }

  static isValid(expression: string): boolean {
    try {
      CronExpression.parse(expression);
      return true;
    } catch {
      return false;
    }
  }

  field(name: CronFieldName): CronField {
    return this.fields.find((field) => field.name === name)!;
  }

  toString(): string {
    return this.text;
  }
}

/** Whether `name` is an IANA timezone this JavaScript engine knows, such as `America/Sao_Paulo`. */
export function isTimeZone(name: string): boolean {
  if (name.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

function parseField(expression: string, text: string, rule: FieldRule): CronField {
  const items = text.split(',').map((item) => parseItem(expression, item, rule));
  return { name: rule.name, text, items, any: text === '*' };
}

function parseItem(expression: string, text: string, rule: FieldRule): CronItem {
  const fail = (problem: string): never => {
    throw new CronExpressionError(expression, `${rule.label} "${text}" ${problem}`);
  };
  const [base, step, ...extra] = text.split('/');
  if (extra.length > 0 || base === '') fail('is malformed');
  let parsedStep: number | undefined;
  if (step !== undefined) {
    if (!/^\d+$/.test(step) || Number(step) < 1) fail('needs a positive whole step');
    parsedStep = Number(step);
  }
  if (base === '*') return { text, step: parsedStep };
  const [first, last, ...more] = base.split('-');
  if (more.length > 0) fail('is malformed');
  const start = value(first, rule) ?? fail(`is not a value from ${rule.min} to ${rule.max}`);
  const end = last === undefined ? start : value(last, rule) ?? fail(`is not a value from ${rule.min} to ${rule.max}`);
  if (end < start) fail('is a range that ends before it starts');
  return { text, range: { start, end }, step: parsedStep };
}

function value(text: string, rule: FieldRule): number | undefined {
  if (/^\d+$/.test(text)) {
    const number = Number(text);
    return number >= rule.min && number <= rule.max ? number : undefined;
  }
  return rule.names?.get(text.toUpperCase());
}
