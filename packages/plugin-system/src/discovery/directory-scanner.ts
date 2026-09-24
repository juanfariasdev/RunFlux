import fs from 'node:fs/promises';
import path from 'node:path';
import type { DiscoveredPlugin } from '../types.js';
import { loadPluginFile } from './plugin-loader.js';

export interface ScanError {
  path: string;
  error: string;
}

export interface ScanResult {
  plugins: DiscoveredPlugin[];
  errors: ScanError[];
}

/**
 * Scans a conventioned directory for plugin subdirectories, each with an entry file (index.ts or
 * index.js) exporting a PluginModule. A malformed plugin is reported in `errors` and never stops
 * discovery of the others (RN-01, EC-01).
 */
export async function scanDirectory(dirPath: string): Promise<ScanResult> {
  const result: ScanResult = { plugins: [], errors: [] };
  let entries: string[];
  try {
    entries = (await fs.readdir(dirPath, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return result; // A missing directory holds no plugins; it is not an error.
  }

  for (const entryName of entries) {
    const pluginDir = path.join(dirPath, entryName);
    const entryFile = await resolveEntryFile(pluginDir);
    if (!entryFile) {
      result.errors.push({ path: pluginDir, error: 'no entry file (index.ts/index.js) found' });
      continue;
    }
    try {
      result.plugins.push(await loadPluginFile(entryFile, pluginDir));
    } catch (error) {
      result.errors.push({ path: pluginDir, error: (error as Error).message });
    }
  }
  return result;
}

async function resolveEntryFile(pluginDir: string): Promise<string | null> {
  for (const candidate of ['index.ts', 'index.js']) {
    const file = path.join(pluginDir, candidate);
    try {
      await fs.access(file);
      return file;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}
