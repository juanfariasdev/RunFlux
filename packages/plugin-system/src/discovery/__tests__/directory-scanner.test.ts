import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanDirectory } from '../directory-scanner';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedFixturesDir = path.join(__dirname, '..', '..', '__tests__', 'fixtures', 'discovery-mixed');
const edgeCasesDir = path.join(__dirname, 'fixtures', 'edge-cases');

describe('scanDirectory — happy path and malformed plugin (RN-01, EC-01)', () => {
  it('discovers the valid plugin and reports the malformed one without stopping', async () => {
    const result = await scanDirectory(sharedFixturesDir);

    expect(result.plugins.map((p) => p.manifest.id)).toContain('fixture-good-plugin');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toMatch(/bad-plugin/);
  });

  it('sets sourcePath to the plugin subdirectory for every discovered plugin', async () => {
    const result = await scanDirectory(sharedFixturesDir);
    const good = result.plugins.find((p) => p.manifest.id === 'fixture-good-plugin');
    expect(good?.sourcePath).toMatch(/good-plugin$/);
  });
});

describe('scanDirectory — edge cases', () => {
  it('returns an empty result (no throw) when the directory does not exist', async () => {
    const result = await scanDirectory(path.join(__dirname, 'this-does-not-exist'));
    expect(result).toEqual({ plugins: [], errors: [] });
  });

  it('reports a plugin subdirectory with no entry file, without affecting siblings', async () => {
    const result = await scanDirectory(edgeCasesDir);
    const noEntryError = result.errors.find((e) => e.path.endsWith('no-entry-file'));
    expect(noEntryError?.error).toMatch(/no entry file/i);
  });

  it('reports a plugin module missing the "manifest"/"generators" exports', async () => {
    const result = await scanDirectory(edgeCasesDir);
    const missingExportsError = result.errors.find((e) => e.path.endsWith('missing-exports'));
    expect(missingExportsError?.error).toMatch(/must export "manifest" and "generators"/i);
  });

  it('finds no valid plugins among purely edge-case fixtures', async () => {
    const result = await scanDirectory(edgeCasesDir);
    expect(result.plugins).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
  });
});
