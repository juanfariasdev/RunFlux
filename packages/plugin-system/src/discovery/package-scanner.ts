import fs from 'node:fs/promises';
import path from 'node:path';
import type { ScanResult } from './directory-scanner.js';
import { loadPluginFile } from './plugin-loader.js';

/** package.json field that marks a package as a RunFlux plugin (RF-01, D-03). */
const CONVENTION_FIELD = 'runflux';

interface PackageJsonWithConvention {
  main?: string;
  [CONVENTION_FIELD]?: { plugin?: boolean };
}

/**
 * Lists package directories under node_modules, resolving one extra level for scoped packages
 * (`@scope/name`) so they are not mistaken for a flat package named "@scope".
 */
async function collectPackageDirectories(nodeModulesDir: string): Promise<string[]> {
  const directories = async (dir: string) => {
    try {
      return (await fs.readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      return [];
    }
  };
  const packages: string[] = [];
  for (const name of await directories(nodeModulesDir)) {
    const dir = path.join(nodeModulesDir, name);
    if (name.startsWith('@')) packages.push(...(await directories(dir)).map((scoped) => path.join(dir, scoped)));
    else packages.push(dir);
  }
  return packages;
}

/**
 * Scans a node_modules directory (including scoped packages) for packages whose package.json
 * declares `runflux.plugin: true`. Same contract as scanDirectory; packages without the marker are
 * skipped silently, since most dependencies are not RunFlux plugins.
 */
export async function scanPackages(nodeModulesDir: string): Promise<ScanResult> {
  const result: ScanResult = { plugins: [], errors: [] };
  for (const pkgDir of await collectPackageDirectories(nodeModulesDir)) {
    let pkgJson: PackageJsonWithConvention;
    try {
      pkgJson = JSON.parse(await fs.readFile(path.join(pkgDir, 'package.json'), 'utf-8'));
    } catch {
      continue;
    }
    if (!pkgJson[CONVENTION_FIELD]?.plugin) continue;
    try {
      result.plugins.push(await loadPluginFile(path.join(pkgDir, pkgJson.main ?? 'index.js'), pkgDir));
    } catch (error) {
      result.errors.push({ path: pkgDir, error: (error as Error).message });
    }
  }
  return result;
}
