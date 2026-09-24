export type YamlValue = string | number | boolean | null | readonly YamlValue[] | { readonly [key: string]: YamlValue | undefined };

/**
 * Serializes plain data as block-style YAML, quoting strings only when YAML would read them as
 * something else. Undefined object entries are skipped; empty collections are written inline.
 */
export function toYaml(value: YamlValue): string {
  return `${lines(value, 0).join('\n')}\n`;
}

function lines(value: YamlValue, depth: number): string[] {
  const indent = '  '.repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}[]`];
    return value.flatMap((item) => (isCollection(item) && !isEmpty(item)
      ? [`${indent}-`, ...lines(item, depth + 1)]
      : [`${indent}- ${scalar(item as Scalar)}`]));
  }
  if (isCollection(value)) {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined) as Array<[string, YamlValue]>;
    if (entries.length === 0) return [`${indent}{}`];
    return entries.flatMap(([key, item]) => (isCollection(item) && !isEmpty(item)
      ? [`${indent}${scalar(key)}:`, ...lines(item, depth + 1)]
      : [`${indent}${scalar(key)}: ${isCollection(item) ? (Array.isArray(item) ? '[]' : '{}') : scalar(item as Scalar)}`]));
  }
  return [`${indent}${scalar(value as Scalar)}`];
}

type Scalar = string | number | boolean | null;

function scalar(value: Scalar): string {
  if (value === null) return 'null';
  if (typeof value !== 'string') return String(value);
  return needsQuotes(value) ? JSON.stringify(value) : value;
}

function needsQuotes(text: string): boolean {
  return text === ''
    || /^[\s-?:,[\]{}#&*!|>'"%@`]/.test(text)
    || /[:#]\s|\s$|:$/.test(text)
    || /^(true|false|yes|no|y|n|on|off|null|~)$/i.test(text)
    || !Number.isNaN(Number(text))
    // YAML 1.1 reads digits separated by colons as a base-60 number, e.g. port mappings.
    || /^\d+(:\d+)+$/.test(text);
}

function isCollection(value: YamlValue | undefined): value is readonly YamlValue[] | { readonly [key: string]: YamlValue | undefined } {
  return value !== null && typeof value === 'object';
}

function isEmpty(value: readonly YamlValue[] | { readonly [key: string]: YamlValue | undefined }): boolean {
  return Array.isArray(value) ? value.length === 0 : Object.values(value).every((item) => item === undefined);
}
