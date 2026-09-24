import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
const cache = new Map<string, string>();

/** Bundle the actual TypeScript implementation; generated backends need no RunFlux installation. */
export function bundleStandalone(moduleId: string, names: string[], namespace: string): string {
  const key = JSON.stringify([moduleId, names, namespace]);
  const cached = cache.get(key);
  if (cached) return cached;
  const entry = require.resolve(moduleId);
  const { outputFiles } = buildSync({
    stdin: { contents: `export { ${names.join(', ')} } from ${JSON.stringify(entry)};`, loader: 'ts', resolveDir: dirname(entry) },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: namespace,
    platform: 'node',
    external: ['pg'],
    target: 'node20',
    legalComments: 'none',
    minifySyntax: true,
  });
  const source = `${outputFiles[0].text}\nconst { ${names.join(', ')} } = ${namespace};\n`;
  cache.set(key, source);
  return source;
}
