import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';
import { runfluxPluginCatalogPlugin } from './vite-plugin-plugin-catalog.ts';
import { runfluxValidationPlugin } from './vite-plugin-validation-runtime.ts';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), runfluxPluginCatalogPlugin(['../../plugins']), runfluxValidationPlugin(['../../plugins'])],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
});
