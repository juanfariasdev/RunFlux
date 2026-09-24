/** A piece of a text that may embed `{{ }}` expressions. */
export type TemplatePart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'expression'; readonly source: string };

/**
 * Splits a text into literal text and the JavaScript of its `{{ }}` blocks. A block ends at the
 * first `}}` outside the string literals and braces of its own JavaScript, so `{{ "}}" }}` and
 * `{{ { a: { b: 1 }} }}` are single expressions. A block whose strings never close ends at the
 * next `}}`, letting the evaluator report the syntax error; `{{` without any `}}` is plain text.
 */
export function parseTemplate(text: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let literalStart = 0;
  let open = text.indexOf('{{');
  while (open !== -1) {
    const close = closingBraces(text, open + 2);
    if (close === -1) break;
    if (open > literalStart) parts.push({ kind: 'text', text: text.slice(literalStart, open) });
    parts.push({ kind: 'expression', source: text.slice(open + 2, close).trim() });
    literalStart = close + 2;
    open = text.indexOf('{{', literalStart);
  }
  if (literalStart < text.length) parts.push({ kind: 'text', text: text.slice(literalStart) });
  return parts;
}

/** Whether `text` embeds at least one `{{ }}` expression. */
export function containsExpression(text: string): boolean {
  return parseTemplate(text).some((part) => part.kind === 'expression');
}

/** The expression of a text made of exactly one `{{ }}` block, ignoring surrounding whitespace. */
export function singleExpression(parts: readonly TemplatePart[]): string | undefined {
  const meaningful = parts.filter((part) => part.kind === 'expression' || part.text.trim() !== '');
  const [only] = meaningful;
  return meaningful.length === 1 && only.kind === 'expression' ? only.source : undefined;
}

function closingBraces(text: string, from: number): number {
  let depth = 0;
  let quote: string | undefined;
  for (let index = from; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      if (depth > 0) depth--;
      else if (text[index + 1] === '}') return index;
    }
  }
  return text.indexOf('}}', from);
}
