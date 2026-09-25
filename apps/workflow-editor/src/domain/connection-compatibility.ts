import type { PluginManifest } from '@runflux/plugin-system/sdk';

/**
 * Returns false when connecting `source`'s output into `target`'s input is
 * not allowed (RF-05):
 * - A trigger starts a flow — it never accepts an incoming connection.
 * - An output node is a terminal step — it never sends to a further node.
 *
 * An unresolved plugin (undefined manifest) never blocks the connection on
 * its own — an already-broken node (EC-01) shouldn't also break connection
 * editing for its neighbors.
 */
export function isConnectionCompatible(
  sourceManifest: PluginManifest | undefined,
  targetManifest: PluginManifest | undefined,
): boolean {
  if (!sourceManifest || !targetManifest) return true;
  if (targetManifest.category === 'trigger') return false;
  if (sourceManifest.category === 'output') return false;
  return true;
}
