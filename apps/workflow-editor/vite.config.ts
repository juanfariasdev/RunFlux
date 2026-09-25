import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';
import { runfluxPluginCatalogPlugin } from './vite-plugin-plugin-catalog.ts';
import { WebhookTestHub } from '@runflux/plugin-system/node';
import { PluginRegistryCache } from './vite-plugin-registry.ts';
import { runfluxValidationPlugin } from './vite-plugin-validation-runtime.ts';

const plugins = new PluginRegistryCache(['../../plugins']);
// Webhook triggers of the editor's test runs wait on this hub for requests sent to their test URL.
const webhooks = new WebhookTestHub();

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), runfluxPluginCatalogPlugin(plugins), runfluxValidationPlugin(plugins, webhooks)],
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
      '/api': {
        target: 'http://localhost:3001',
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
