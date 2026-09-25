import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('the sdk entry', () => {
  it('bundles for the browser without discovery, the registry or any Node.js module', async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL('../sdk.ts', import.meta.url))],
      bundle: true,
      platform: 'browser',
      write: false,
      logLevel: 'silent',
      metafile: true,
    });
    const inputs = Object.keys(result.metafile!.inputs);
    expect(inputs.filter((input) => /\/(discovery|plugin-registry|plugin-catalog-provider|webhook-test-hub)/.test(input) || input.startsWith('node:'))).toEqual([]);
  });
});
