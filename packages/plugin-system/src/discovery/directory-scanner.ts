import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateManifest } from '../manifest-validator';
import { importPlugin } from './import-plugin.js';
import type { DiscoveredPlugin, PluginModule } from '../types';

export interface ScanError {
  path: string;
  error: string;
}

export interface ScanResult {
  plugins: DiscoveredPlugin[];
  errors: ScanError[];
}

/**
 * Scans a conventioned directory for plugin subdirectories. Each subdirectory
 * is expected to have an entry file (index.ts/index.js) exporting `manifest`
 * and `generators` (PluginModule). A malformed plugin is reported in
 * `errors` and never stops discovery of the remaining plugins (RN-01, EC-01).
 */
export async function scanDirectory(dirPath: string): Promise<ScanResult> {
  const plugins: DiscoveredPlugin[] = [];
  const errors: ScanError[] = [];

  let entries: string[];
  try {
    entries = (await fs.readdir(dirPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // No such directory: not an error condition for the caller, just no plugins found here.
    return { plugins, errors };
  }

  for (const entryName of entries) {
    const pluginDir = path.join(dirPath, entryName);
    const entryFile = await resolveEntryFile(pluginDir);
    if (!entryFile) {
      errors.push({ path: pluginDir, error: 'no entry file (index.ts/index.js) found' });
      continue;
    }

    try {
      const entryUrl = pathToFileURL(entryFile);
      const { mtimeNs, size } = await fs.stat(entryFile, { bigint: true });
      entryUrl.searchParams.set('runflux-version', `${mtimeNs}-${size}`);
      const mod = await importPlugin(entryUrl);
      if (!mod.manifest || !mod.generators) {
        errors.push({ path: pluginDir, error: 'module must export "manifest" and "generators"' });
        continue;
      }

      const validation = validateManifest(mod.manifest);
      if (!validation.success) {
        errors.push({ path: pluginDir, error: validation.error });
        continue;
      }

      plugins.push({
        manifest: validation.manifest,
        generators: mod.generators,
        execute: mod.execute,
        sourcePath: pluginDir,
      });
    } catch (err) {
      errors.push({ path: pluginDir, error: (err as Error).message });
    }
  }

  return { plugins, errors };
}

async function resolveEntryFile(pluginDir: string): Promise<string | null> {
  for (const candidate of ['index.ts', 'index.js']) {
    const full = path.join(pluginDir, candidate);
    try {
      await fs.access(full);
      return full;
    } catch {
      // try next candidate
    }
  }
  return null;
}
