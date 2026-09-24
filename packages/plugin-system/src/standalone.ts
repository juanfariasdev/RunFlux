import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
const cache = new Map<string, string>();

/** Bundle the actual TypeScript implementation; generated backends need no RunFlux installation. */
export function bundleStandalone(moduleId: string, names: string[], namespace: string, external: string[] = []): string {
  const key = JSON.stringify([moduleId, names, namespace, external]);
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
    external,
    target: 'node20',
    legalComments: 'none',
    minifySyntax: true,
  });
  const imports = external.map((id, index) => `import * as ${namespace}_dependency${index} from ${JSON.stringify(id)};`).join('\n');
  const resolve = external.map((id, index) => `if (id === ${JSON.stringify(id)}) return ${namespace}_dependency${index};`).join('\n');
  const bundled = external.length
    ? `${imports}\nconst ${namespace} = ((require) => { ${outputFiles[0].text}\nreturn ${namespace}; })((id) => { ${resolve}\nthrow new Error('Unknown dependency: ' + id); });`
    : outputFiles[0].text;
  const source = `${bundled}\nconst { ${names.join(', ')} } = ${namespace};\n`;
  cache.set(key, source);
  return source;
}
