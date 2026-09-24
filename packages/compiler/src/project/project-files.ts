import type { GeneratedFile } from '../types.js';

/** The files of a generated project, in insertion order. A path can be added only once. */
export class ProjectFiles {
  private readonly files = new Map<string, GeneratedFile>();

  add(file: GeneratedFile): this {
    if (this.files.has(file.path)) throw new Error(`Duplicate generated file "${file.path}"`);
    this.files.set(file.path, file);
    return this;
  }

  addAll(files: Iterable<GeneratedFile>): this {
    for (const file of files) this.add(file);
    return this;
  }

  text(path: string, content: string, type: GeneratedFile['type']): this {
    return this.add({ path, content, type });
  }

  /** Adds a JSON document, formatted with two spaces and a final newline. */
  json(path: string, value: unknown, type: GeneratedFile['type'] = 'config'): this {
    return this.text(path, `${JSON.stringify(value, null, 2)}\n`, type);
  }

  list(): GeneratedFile[] {
    return [...this.files.values()];
  }
}
