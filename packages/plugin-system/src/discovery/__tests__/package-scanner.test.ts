import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanPackages } from '../package-scanner';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeModulesDir = path.join(__dirname, 'fixtures', 'node_modules');

describe('scanPackages', () => {
  it('discovers an unscoped package marked with runflux.plugin', async () => {
    const result = await scanPackages(nodeModulesDir);
    expect(result.plugins.map((p) => p.manifest.id)).toContain('fixture-marked-plugin');
  });

  it('discovers a scoped (@scope/name) package marked with runflux.plugin', async () => {
    const result = await scanPackages(nodeModulesDir);
    expect(result.plugins.map((p) => p.manifest.id)).toContain('fixture-scoped-plugin');
  });

  it('never imports a package without the runflux.plugin marker (would throw if it did)', async () => {
    // unmarked-package/index.js throws if imported — a successful scan
    // (no unhandled rejection, no crash) proves it was skipped without a read.
    const result = await scanPackages(nodeModulesDir);
    expect(result.errors.some((e) => e.path.includes('unmarked-package'))).toBe(false);
    expect(result.plugins.some((p) => p.sourcePath.includes('unmarked-package'))).toBe(false);
  });

  it('reports a marked-but-malformed package as an error, without stopping the scan (RN-01)', async () => {
    const result = await scanPackages(nodeModulesDir);
    const error = result.errors.find((e) => e.path.includes('malformed-marked-plugin'));
    expect(error).toBeDefined();
    // the two valid plugins are still discovered despite the malformed one
    expect(result.plugins).toHaveLength(2);
  });

  it('returns an empty result (no throw) when the node_modules directory does not exist', async () => {
    const result = await scanPackages(path.join(__dirname, 'this-does-not-exist'));
    expect(result).toEqual({ plugins: [], errors: [] });
  });
});
