import { tsImport } from 'tsx/esm/api';

/** Native Node and Vite must resolve TypeScript plugins identically, including their .js imports. */
export async function importPlugin<TModule>(url: URL): Promise<TModule> {
  return /\.[cm]?tsx?$/.test(url.pathname)
    ? tsImport(url.href, import.meta.url)
    : import(url.href);
}
