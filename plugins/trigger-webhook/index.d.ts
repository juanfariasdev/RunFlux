import type { PluginModule } from '@runflux/plugin-system/types';
export declare const manifest: PluginModule['manifest'];
export declare const generators: PluginModule['generators'];
/**
 * Pushes an incoming test webhook event from the dev server or project server
 * to any node currently awaiting an event in the canvas editor.
 */
export declare function pushTestWebhook(targetPath: string, payload: any): boolean;
/**
 * Clears any pending webhook listeners.
 */
export declare function clearPendingWebhooks(): void;
export declare const execute: PluginModule['execute'];
