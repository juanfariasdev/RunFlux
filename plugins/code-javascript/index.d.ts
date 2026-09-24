import type { PluginModule } from '@runflux/plugin-system/types';
/**
 * Code Node (010-code-node-plugin): executes arbitrary user-authored
 * JavaScript / TypeScript functions receiving ($json, $node, $env).
 */
export declare const manifest: PluginModule['manifest'];
export declare const generators: PluginModule['generators'];
export declare const execute: PluginModule['execute'];
