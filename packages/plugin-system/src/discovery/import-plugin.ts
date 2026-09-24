import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';

/**
 * Imports a plugin file so that an edited plugin is loaded again. TypeScript goes through tsx,
 * which resolves the `.js` specifiers of TypeScript imports under native Node and Vite alike and
 * never caches: the file and its local imports, helpers included, load again on every call.
 * JavaScript keeps Node's own semantics; its URL carries the file's modification stamp, so a
 * changed file is loaded again (helpers it imports stay cached until the process restarts).
 */
export async function importPlugin<TModule>(url: URL): Promise<TModule> {
  if (/\.[cm]?tsx?$/.test(url.pathname)) return tsImport(url.href, import.meta.url);
  return import((await versioned(url)).href);
}

async function versioned(url: URL): Promise<URL> {
  if (url.protocol !== 'file:') return url;
  const { mtimeNs, size } = await fs.stat(fileURLToPath(url), { bigint: true });
  const stamped = new URL(url);
  stamped.searchParams.set('runflux-version', `${mtimeNs}-${size}`);
  return stamped;
}
