// Intentionally malformed fixture: missing required "id" field.
// Cast through `unknown` to simulate a plugin authored without the type
// system catching the mistake (e.g. a plain-JS plugin) — runtime validation
// (manifest-validator.ts) is what's expected to catch this, not the compiler.
export const manifest = {
  name: 'Fixture Bad Plugin',
  category: 'action',
  version: '1.0.0',
  parameters: [],
  supportedPlatforms: ['local'],
} as unknown as import('../../../../types').PluginModule['manifest'];

export const runtimeModule = new URL('./index.ts', import.meta.url);
