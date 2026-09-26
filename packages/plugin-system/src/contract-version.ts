/**
 * Version of the plugin contract: the manifest (`PluginManifest`, `ParameterSchema`) and the module
 * layout of a plugin. A minor version adds to it; a major version breaks it. Every compiled backend
 * records it in `runflux-build.json`.
 */
export const PLUGIN_CONTRACT_VERSION = '1.1.0';
