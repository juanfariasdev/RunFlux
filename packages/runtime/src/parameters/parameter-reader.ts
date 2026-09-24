import { isRecord } from '../values.js';

export class ParameterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParameterError';
  }
}

/**
 * Typed access to a node's parameters. A missing value (undefined, null or blank text) falls back
 * to the given default; a value of the wrong type raises a ParameterError that names the node type.
 */
export interface ParameterReader {
  /** The value exactly as configured, for parameters that accept any JSON. */
  raw(name: string): unknown;
  /** Every parameter exactly as configured, for nodes that accept arbitrary parameters. */
  all(): Readonly<Record<string, unknown>>;
  string(name: string, fallback: string): string;
  requiredString(name: string): string;
  optionalString(name: string): string | undefined;
  boolean(name: string, fallback: boolean): boolean;
  choice<TOption extends string>(name: string, options: readonly TOption[], fallback: TOption): TOption;
  list(name: string): unknown[];
  record(name: string): Record<string, unknown>;
  /** A ParameterError for a problem found while interpreting a parameter's value. */
  error(name: string, problem: string): ParameterError;
}

/** Reads the parameters of one node from a plain object. */
export class ObjectParameterReader implements ParameterReader {
  private readonly values: Readonly<Record<string, unknown>>;
  private readonly owner: string;

  /** `owner` names the node type in error messages. */
  constructor(values: Readonly<Record<string, unknown>>, owner: string) {
    this.values = values;
    this.owner = owner;
  }

  raw(name: string): unknown {
    return this.values[name];
  }

  all(): Readonly<Record<string, unknown>> {
    return this.values;
  }

  string(name: string, fallback: string): string {
    return this.optionalString(name) ?? fallback;
  }

  requiredString(name: string): string {
    const value = this.optionalString(name);
    if (value === undefined) throw this.error(name, 'is required');
    return value;
  }

  optionalString(name: string): string | undefined {
    const value = this.values[name];
    if (isMissing(value)) return undefined;
    if (typeof value !== 'string') throw this.error(name, 'must be text');
    return value;
  }

  boolean(name: string, fallback: boolean): boolean {
    const value = this.values[name];
    if (isMissing(value)) return fallback;
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 'false') return value === 'true';
    throw this.error(name, 'must be true or false');
  }

  choice<TOption extends string>(name: string, options: readonly TOption[], fallback: TOption): TOption {
    const value = this.string(name, fallback);
    if (!options.includes(value as TOption)) {
      throw this.error(name, `must be one of ${options.map((option) => `"${option}"`).join(', ')}`);
    }
    return value as TOption;
  }

  list(name: string): unknown[] {
    const value = this.values[name];
    if (isMissing(value)) return [];
    if (!Array.isArray(value)) throw this.error(name, 'must be a list');
    return value;
  }

  record(name: string): Record<string, unknown> {
    const value = this.values[name];
    if (isMissing(value)) return {};
    if (!isRecord(value)) throw this.error(name, 'must be an object');
    return value;
  }

  error(name: string, problem: string): ParameterError {
    return new ParameterError(`${this.owner}: parameter "${name}" ${problem}`);
  }
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}
