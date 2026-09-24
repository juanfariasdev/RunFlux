import { tsImport } from 'tsx/esm/api';
import type { PluginModule } from '../types.js';

/** Native Node and Vite must resolve TypeScript plugins identically, including their .js imports. */
export async function importPlugin(url: URL): Promise<Partial<PluginModule>> {
  return /\.[cm]?tsx?$/.test(url.pathname)
    ? tsImport(url.href, import.meta.url)
    : import(url.href);
}
