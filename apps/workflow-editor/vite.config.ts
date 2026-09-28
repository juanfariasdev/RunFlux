import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';
import { runfluxPluginCatalogPlugin } from './vite-plugin-plugin-catalog.ts';
import { WebhookTestHub } from '@runflux/plugin-system/node';
import { PluginRegistryCache } from './vite-plugin-registry.ts';
import { runfluxValidationPlugin } from './vite-plugin-validation-runtime.ts';
import { loadPlatformSettings } from './vite-platform.ts';

const plugins = new PluginRegistryCache(['../../plugins']);
// Webhook triggers of the editor's test runs wait on this hub for requests sent to their test URL.
const webhooks = new WebhookTestHub();
// The platform token and the project server's address, shared with apps/project-server/.env (feature 015, D-13).
const platform = loadPlatformSettings();

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), runfluxPluginCatalogPlugin(plugins, platform), runfluxValidationPlugin(plugins, webhooks, platform)],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 30,
            },
            {
              name: 'xyflow-vendor',
              test: /node_modules[\\/]@xyflow[\\/]/,
              priority: 25,
            },
            {
              name: 'forms-vendor',
              test: /node_modules[\\/](?:@hookform[\\/]|react-hook-form[\\/]|zod[\\/])/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      // 127.0.0.1, not localhost: the project server binds to IPv4 loopback, and localhost may resolve to ::1.
      '/api': {
        target: platform.projectServerUrl,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
});
