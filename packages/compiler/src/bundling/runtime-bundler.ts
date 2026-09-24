import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin as EsbuildPlugin } from 'esbuild';
import type { BundledPlugin } from '../deployment/deployment-plan.js';
import type { GeneratedFile } from '../types.js';

/** A public entry point of the runtime package: its subpath and source file. */
export interface RuntimeEntry {
  /** Subpath of `@runflux/runtime` (`.` for the package itself). */
  readonly subpath: string;
  /** Output file name, without extension. */
  readonly name: string;
  /** Source file, relative to the runtime package's `src`. */
  readonly source: string;
}

export const RUNTIME_ENTRIES = {
  core: { subpath: '.', name: 'index', source: 'index.ts' },
  express: { subpath: './express', name: 'express', source: 'hosts/express/index.ts' },
  lambda: { subpath: './lambda', name: 'lambda', source: 'hosts/lambda/index.ts' },
  cron: { subpath: './cron', name: 'cron', source: 'hosts/cron/index.ts' },
  cli: { subpath: './cli', name: 'cli', source: 'hosts/cli/index.ts' },
} satisfies Record<string, RuntimeEntry>;

export interface RuntimeBundleRequest {
  readonly entries: readonly RuntimeEntry[];
  readonly plugins: readonly BundledPlugin[];
  /** npm packages left for the backend to install (hosts' and plugins' dependencies). */
  readonly external: readonly string[];
}

export class RuntimeBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeBundleError';
  }
}

/** Where the bundle lives inside an exported project; the project depends on it as `file:`. */
export const VENDOR_DIRECTORY = 'vendor/runflux-runtime';

const PLUGINS_MODULE = 'runflux:plugins';

/**
 * Compiles `@runflux/runtime` and the runtimes of the given plugins into a self-contained package:
 * ESM JavaScript plus the runtime's type declarations. Its `plugins` module maps each plugin id to
 * its node definition, replacing the empty module of the source package.
 */
export class RuntimeBundler {
  private readonly packageDirectory: string;

  constructor(packageDirectory = locateRuntimePackage()) {
    this.packageDirectory = packageDirectory;
  }

  async bundle(request: RuntimeBundleRequest): Promise<GeneratedFile[]> {
    const sourceDirectory = path.join(this.packageDirectory, 'src');
    const [javascript, declarations] = await Promise.all([this.compile(request, sourceDirectory), this.declarations(sourceDirectory)]);
    return [this.packageJson(request.entries), ...javascript, ...declarations];
  }

  /** The version ranges the runtime package declares for some of its dependencies. */
  dependencyVersions(names: readonly string[]): Record<string, string> {
    const manifest = JSON.parse(readFileSync(path.join(this.packageDirectory, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    return Object.fromEntries(names.map((name) => {
      const version = manifest.dependencies?.[name];
      if (!version) throw new RuntimeBundleError(`@runflux/runtime does not declare the dependency "${name}"`);
      return [name, version];
    }));
  }

  private async compile(request: RuntimeBundleRequest, sourceDirectory: string): Promise<GeneratedFile[]> {
    const outdir = path.join(this.packageDirectory, '.bundle');
    let result;
    try {
      result = await build({
        entryPoints: [
          ...request.entries.map((entry) => ({ in: path.join(sourceDirectory, entry.source), out: entry.name })),
          { in: PLUGINS_MODULE, out: 'plugins' },
        ],
        bundle: true,
        splitting: true,
        format: 'esm',
        platform: 'node',
        target: 'node22',
        outdir,
        write: false,
        external: [...request.external],
        legalComments: 'none',
        logLevel: 'silent',
        plugins: [pluginsModule(request.plugins), singleRuntime(path.join(sourceDirectory, 'index.ts')), noEditorPackages()],
      });
    } catch (error) {
      const failure = error as { errors?: Array<{ text: string; location?: { file: string } | null }> };
      const details = failure.errors?.map((item) => (item.location ? `${item.location.file}: ${item.text}` : item.text)).join('; ');
      throw new RuntimeBundleError(`Could not bundle the runtime: ${details ?? String(error)}`);
    }
    return result.outputFiles.map((file) => ({
      path: `${VENDOR_DIRECTORY}/${path.relative(outdir, file.path).split(path.sep).join('/')}`,
      content: file.text,
      type: 'runtime',
    }));
  }

  /**
   * The declarations tsc wrote for the runtime's current sources; those left over from deleted
   * sources are skipped. tsc leaves unchanged declarations untouched, so freshness is judged by its
   * build info, which every build that saw a change rewrites: a source edited after it means the
   * declarations may be stale.
   */
  private async declarations(sourceDirectory: string): Promise<GeneratedFile[]> {
    const typesDirectory = path.join(this.packageDirectory, 'dist');
    const rebuild = 'run "npm run build:node -w @runflux/runtime"';
    const sources = (await listFiles(sourceDirectory)).filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'));
    const files = await listFiles(typesDirectory).catch(() => []);
    const declarations = files.filter((file) => file.endsWith('.d.ts')
      && !/(^|\/)(__tests__|testing)\//.test(file)
      && sources.includes(file.replace(/\.d\.ts$/, '.ts')));
    if (!declarations.includes('index.d.ts')) throw new RuntimeBundleError(`Runtime type declarations are missing in ${typesDirectory}; ${rebuild}`);
    const stale = await this.editedAfterBuild(sourceDirectory, sources);
    if (stale) throw new RuntimeBundleError(`Runtime type declarations are older than src/${stale}; ${rebuild}`);
    return Promise.all(declarations.map(async (file) => ({
      path: `${VENDOR_DIRECTORY}/types/${file}`,
      content: await fs.readFile(path.join(typesDirectory, file), 'utf8'),
      type: 'runtime' as const,
    })));
  }

  /** A source changed after the last build, if the package keeps tsc build info. */
  private async editedAfterBuild(sourceDirectory: string, sources: readonly string[]): Promise<string | undefined> {
    const buildInfo = await fs.stat(path.join(this.packageDirectory, 'tsconfig.tsbuildinfo')).catch(() => undefined);
    if (!buildInfo) return undefined;
    for (const source of sources) {
      if ((await fs.stat(path.join(sourceDirectory, source))).mtimeMs > buildInfo.mtimeMs) return source;
    }
    return undefined;
  }

  private packageJson(entries: readonly RuntimeEntry[]): GeneratedFile {
    const exports = Object.fromEntries([
      ...entries.map((entry) => [entry.subpath, { types: `./types/${entry.source.replace(/\.ts$/, '.d.ts')}`, default: `./${entry.name}.js` }]),
      ['./plugins', { types: './types/plugins.d.ts', default: './plugins.js' }],
    ]);
    const manifest = { name: '@runflux/runtime', version: '0.1.0', private: true, type: 'module', main: './index.js', exports };
    return { path: `${VENDOR_DIRECTORY}/package.json`, content: `${JSON.stringify(manifest, null, 2)}\n`, type: 'runtime' };
  }
}

/** The `plugins` module: imports each plugin's runtime and maps its id to the definition. */
function pluginsModule(plugins: readonly BundledPlugin[]): EsbuildPlugin {
  return {
    name: 'runflux-plugins',
    setup(builder) {
      builder.onResolve({ filter: /^runflux:plugins$/ }, () => ({ path: PLUGINS_MODULE, namespace: 'runflux' }));
      builder.onLoad({ filter: /.*/, namespace: 'runflux' }, () => ({
        loader: 'js',
        resolveDir: process.cwd(),
        contents: [
          ...plugins.map((plugin, index) => `import plugin${index} from ${JSON.stringify(toPath(plugin.runtimeModule))};`),
          `export const plugins = { ${plugins.map((plugin, index) => `${JSON.stringify(plugin.id)}: plugin${index}`).join(', ')} };`,
        ].join('\n'),
      }));
    },
  };
}

/** Plugins anywhere on disk share the one runtime being bundled. */
function singleRuntime(runtimeIndex: string): EsbuildPlugin {
  return {
    name: 'runflux-single-runtime',
    setup(builder) {
      builder.onResolve({ filter: /^@runflux\/runtime$/ }, () => ({ path: runtimeIndex }));
    },
  };
}

/** Editor-side packages (discovery, zod, tsx…) must never reach a backend. */
function noEditorPackages(): EsbuildPlugin {
  return {
    name: 'runflux-no-editor-packages',
    setup(builder) {
      builder.onResolve({ filter: /^@runflux\// }, (args) => (/^@runflux\/runtime(\/|$)/.test(args.path) ? undefined : {
        errors: [{ text: `backend code must not import "${args.path}" (imported by ${args.importer}); import @runflux/runtime instead` }],
      }));
    },
  };
}

function locateRuntimePackage(): string {
  const entry = createRequire(import.meta.url).resolve('@runflux/runtime');
  return path.resolve(path.dirname(entry), '..');
}

function toPath(location: URL | string): string {
  if (location instanceof URL) return fileURLToPath(location);
  return location.startsWith('file:') ? fileURLToPath(location) : location;
}

async function listFiles(directory: string, prefix = ''): Promise<string[]> {
  const entries = await fs.readdir(path.join(directory, prefix), { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(directory, relative) : Promise.resolve([relative]);
  }));
  return nested.flat();
}
