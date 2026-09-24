import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GeneratedFile } from '../types.js';

const DEFAULT_ROOT = fileURLToPath(new URL('../../templates/', import.meta.url));

/**
 * The static files of exported projects, stored as real (type-checked) files under
 * `packages/compiler/templates/<set>/`. Files are copied verbatim, keeping their relative paths.
 */
export class TemplateDirectory {
  constructor(private readonly root = DEFAULT_ROOT) {}

  /** Every file of the given template sets, or only those `include` accepts. */
  async files(sets: readonly string[], include: (file: string) => boolean = () => true): Promise<GeneratedFile[]> {
    const files = await Promise.all(sets.map(async (set) => {
      const directory = path.join(this.root, set);
      return (await listFiles(directory)).filter(include).map(async (file): Promise<GeneratedFile> => ({
        path: file,
        content: await fs.readFile(path.join(directory, file), 'utf8'),
        type: typeOf(file),
      }));
    }));
    return Promise.all(files.flat());
  }
}

function typeOf(file: string): GeneratedFile['type'] {
  if (file.startsWith('src/')) return 'source';
  if (file.startsWith('bin/') || file.startsWith('lib/') || /Dockerfile|\.dockerignore/.test(file)) return 'infrastructure';
  return 'config';
}

async function listFiles(directory: string, prefix = ''): Promise<string[]> {
  const entries = await fs.readdir(path.join(directory, prefix), { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(directory, relative) : Promise.resolve([relative]);
  }));
  return nested.flat().sort();
}
