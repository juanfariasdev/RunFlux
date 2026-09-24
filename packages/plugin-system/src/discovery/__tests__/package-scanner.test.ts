import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanPackages } from '../package-scanner';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// A stand-in for a node_modules directory. It is not named node_modules so git tracks it.
const packagesDir = path.join(__dirname, 'fixtures', 'packages');

describe('scanPackages', () => {
  it('discovers unscoped and scoped packages marked with runflux.plugin, with their runtime', async () => {
    const result = await scanPackages(packagesDir);
    expect(result.plugins.map((plugin) => plugin.manifest.id).sort()).toEqual(['fixture-marked-plugin', 'fixture-scoped-plugin']);
    expect(result.plugins.every((plugin) => typeof plugin.definition.createHandler === 'function')).toBe(true);
  });

  it('never imports a package without the marker (it would throw if it did)', async () => {
    const result = await scanPackages(packagesDir);
    expect(result.errors.some((error) => error.path.includes('unmarked-package'))).toBe(false);
    expect(result.plugins.some((plugin) => plugin.sourcePath.includes('unmarked-package'))).toBe(false);
  });

  it('reports a marked but malformed package without stopping the scan (RN-01)', async () => {
    const result = await scanPackages(packagesDir);
    expect(result.errors).toEqual([expect.objectContaining({ path: expect.stringContaining('malformed-marked-plugin') })]);
  });

  it('returns an empty result when the directory does not exist', async () => {
    expect(await scanPackages(path.join(__dirname, 'this-does-not-exist'))).toEqual({ plugins: [], errors: [] });
  });
});
