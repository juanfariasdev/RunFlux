import path from 'node:path';
import { build, type BuildOptions } from 'esbuild';
import { VENDOR_DIRECTORY } from '../bundling/runtime-bundler.js';
import type { BuildManifest } from '../types.js';

const REQUIRE_SHIM = "import { createRequire } from 'module'; const require = createRequire(import.meta.url);";

/**
 * How an exported project bundles its entry points into `dist/`. One profile yields both the
 * project's own `npm run build` script and the build RunFlux runs before offering the download,
 * so the two never drift apart.
 */
export class BuildProfile {
  private constructor(
    readonly entryPoints: readonly string[],
    /** Whether npm dependencies go into the bundle (Lambda) or stay in node_modules (server). */
    readonly bundleDependencies: boolean,
  ) {}

  /** A long-running Node.js server: dependencies are installed next to it. */
  static server(entryPoints: readonly string[]): BuildProfile {
    return new BuildProfile(entryPoints, false);
  }

  /** A self-contained function package, such as a Lambda zip. */
  static function(entryPoints: readonly string[]): BuildProfile {
    return new BuildProfile(entryPoints, true);
  }

  /** The profile recorded in a project's runflux-build.json. */
  static fromManifest(manifest: Pick<BuildManifest, 'build'>): BuildProfile {
    return new BuildProfile(manifest.build.entryPoints, manifest.build.bundleDependencies);
  }

  /** The esbuild command of the project's `build` script. */
  command(): string {
    return ['esbuild', ...this.entryPoints, ...this.flags()].join(' ');
  }

  /**
   * Builds the project in `directory` without installing it: the vendored runtime is resolved from
   * the project itself and other dependencies from `nodePaths`.
   */
  async build(directory: string, nodePaths: readonly string[] = []): Promise<void> {
    await build({
      ...this.options(),
      absWorkingDir: directory,
      entryPoints: this.entryPoints.map((entry) => path.join(directory, entry)),
      outdir: path.join(directory, 'dist'),
      alias: { '@runflux/runtime': path.join(directory, VENDOR_DIRECTORY) },
      nodePaths: [...nodePaths],
      logLevel: 'silent',
    });
  }

  private options(): BuildOptions {
    return {
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      outExtension: { '.js': '.mjs' },
      ...(this.bundleDependencies ? { banner: { js: REQUIRE_SHIM } } : { packages: 'external' as const, splitting: this.entryPoints.length > 1 }),
    };
  }

  private flags(): string[] {
    const options = this.options();
    return [
      '--bundle',
      `--format=${options.format}`,
      ...(options.splitting ? ['--splitting'] : []),
      ...(options.packages === 'external' ? ['--packages=external'] : []),
      '--out-extension:.js=.mjs',
      `--platform=${options.platform}`,
      `--target=${options.target}`,
      ...(options.banner ? [`--banner:js="${REQUIRE_SHIM}"`] : []),
      '--outdir=dist',
    ];
  }
}
