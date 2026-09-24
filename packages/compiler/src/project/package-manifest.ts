import { VENDOR_DIRECTORY } from '../bundling/runtime-bundler.js';
import { sortedRecord } from './records.js';

/** Versions of the tools every exported project builds with. */
export const TOOL_VERSIONS = {
  '@types/node': '^22.5.0',
  esbuild: '^0.28.2',
  tsx: '^4.19.0',
  typescript: '^5.5.4',
} as const;

export const NODE_VERSION = '>=22';

export interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly private: true;
  readonly type: 'module';
  readonly engines: { readonly node: string };
  readonly scripts: Readonly<Record<string, string>>;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
}

export interface PackageManifestSpec {
  readonly name: string;
  readonly scripts: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

/**
 * The package.json of an exported project: an ES module package on the vendored runtime, built
 * with the shared tool versions. Dependency lists are sorted as npm writes them.
 */
export function packageManifest(spec: PackageManifestSpec): PackageManifest {
  return {
    name: spec.name,
    version: '1.0.0',
    private: true,
    type: 'module',
    engines: { node: NODE_VERSION },
    scripts: spec.scripts,
    dependencies: sortedRecord({ '@runflux/runtime': `file:./${VENDOR_DIRECTORY}`, ...spec.dependencies }),
    devDependencies: sortedRecord({ ...TOOL_VERSIONS, ...spec.devDependencies }),
  };
}
