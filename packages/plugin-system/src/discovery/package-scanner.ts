import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateManifest } from '../manifest-validator';
import { importPlugin } from './import-plugin.js';
import type { DiscoveredPlugin } from '../types';
import type { ScanError, ScanResult } from './directory-scanner';

/** package.json field that marks a package as a RunFlux plugin (RF-01, D-03). */
const CONVENTION_FIELD = 'runflux';

interface PackageJsonWithConvention {
  main?: string;
  [CONVENTION_FIELD]?: { plugin?: boolean };
}

interface PackageCandidate {
  /** The package name as it would appear in package.json (e.g. "@scope/name" or "name"). */
  name: string;
  dir: string;
}

/**
 * Lists package directories under node_modules, resolving one extra level for
 * scoped packages (`@scope/name`) so they're not mistaken for a flat package
 * named "@scope".
 */
async function collectPackageCandidates(nodeModulesDir: string): Promise<PackageCandidate[]> {
  let topLevel: string[];
  try {
    topLevel = (await fs.readdir(nodeModulesDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const candidates: PackageCandidate[] = [];
  for (const entryName of topLevel) {
    if (entryName.startsWith('@')) {
      const scopeDir = path.join(nodeModulesDir, entryName);
      let scopedPackages: string[];
      try {
        scopedPackages = (await fs.readdir(scopeDir, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      } catch {
        continue;
      }
      for (const scopedName of scopedPackages) {
        candidates.push({ name: `${entryName}/${scopedName}`, dir: path.join(scopeDir, scopedName) });
      }
    } else {
      candidates.push({ name: entryName, dir: path.join(nodeModulesDir, entryName) });
    }
  }
  return candidates;
}

/**
 * Scans a node_modules directory (including scoped `@scope/name` packages)
 * for packages whose package.json declares the `runflux.plugin: true`
 * convention marker. Same discovery contract as directory-scanner.ts: a
 * malformed plugin is reported in `errors`, never stops discovery of the
 * rest (RN-01, EC-01). A package without the marker is skipped silently —
 * not every node_modules entry is expected to be a RunFlux plugin.
 */
export async function scanPackages(nodeModulesDir: string): Promise<ScanResult> {
  const plugins: DiscoveredPlugin[] = [];
  const errors: ScanError[] = [];

  const candidates = await collectPackageCandidates(nodeModulesDir);

  for (const { dir: pkgDir } of candidates) {
    const pkgJsonPath = path.join(pkgDir, 'package.json');

    let pkgJson: PackageJsonWithConvention;
    try {
      pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, 'utf-8'));
    } catch {
      continue; // not every node_modules entry has a readable package.json; not a plugin, skip silently
    }

    if (!pkgJson[CONVENTION_FIELD]?.plugin) {
      continue; // not marked as a RunFlux plugin, skip silently
    }

    const entryFile = path.join(pkgDir, pkgJson.main ?? 'index.js');
    try {
      const mod = await importPlugin(pathToFileURL(entryFile));
      if (!mod.manifest || !mod.generators) {
        errors.push({ path: pkgDir, error: 'module must export "manifest" and "generators"' });
        continue;
      }

      const validation = validateManifest(mod.manifest);
      if (!validation.success) {
        errors.push({ path: pkgDir, error: validation.error });
        continue;
      }

      plugins.push({
        manifest: validation.manifest,
        generators: mod.generators,
        execute: mod.execute,
        sourcePath: pkgDir,
      });
    } catch (err) {
      errors.push({ path: pkgDir, error: (err as Error).message });
    }
  }

  return { plugins, errors };
}
