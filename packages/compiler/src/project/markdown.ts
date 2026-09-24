/** Builds a Markdown document block by block, separating blocks with one blank line. */
export class MarkdownDocument {
  private readonly blocks: string[] = [];

  heading(level: 1 | 2 | 3, text: string): this {
    return this.block(`${'#'.repeat(level)} ${text}`);
  }

  paragraph(text: string): this {
    return this.block(text);
  }

  list(items: readonly string[]): this {
    return items.length === 0 ? this : this.block(items.map((item) => `- ${item}`).join('\n'));
  }

  code(language: string, lines: readonly string[]): this {
    return this.block(['```' + language, ...lines, '```'].join('\n'));
  }

  toString(): string {
    return `${this.blocks.join('\n\n')}\n`;
  }

  private block(text: string): this {
    this.blocks.push(text);
    return this;
  }
}

/** Inline code. */
export function code(text: string): string {
  return `\`${text}\``;
}
