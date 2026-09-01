import type { PluginManifest } from './types';
import { validateManifest, type ManifestValidationResult } from './manifest-validator';

/**
 * Serializes a validated PluginManifest (authored in TypeScript, D-02) to its
 * canonical JSON form. This JSON is what circulates in the in-memory registry
 * and in project export/import (workflow-project-management RF-07/RF-08).
 */
export function serializeManifest(manifest: PluginManifest): string {
  return JSON.stringify(manifest, Object.keys(manifest).sort());
}

/** Deserializes and validates a JSON manifest string back into a PluginManifest. */
export function deserializeManifest(json: string): ManifestValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { success: false, error: `invalid JSON: ${(err as Error).message}` };
  }
  return validateManifest(parsed);
}
