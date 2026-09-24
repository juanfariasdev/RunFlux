import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';

const require = createRequire(import.meta.url);

/** Test a trusted generated module through its real exports. External systems may be injected. */
export function loadGeneratedModule(source: string, dependencies: Record<string, unknown> = {}, resolve: (name: string) => unknown = require): Record<string, any> {
  const { code } = transformSync(source, { loader: 'ts', format: 'cjs', target: 'node20' });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports,
    (name: string) => Object.hasOwn(dependencies, name) ? dependencies[name] : resolve(name));
  return module.exports;
}
